// Build executor: creates a real Asana project from staged sections/tasks.
// Batched through POST /batch (10 actions max), progress tracked in memory
// and mirrored to a manifest file so a crashed run can be inspected.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { asanaFetch } from './asana';

export interface BuildTask {
  name: string;
  completed?: boolean;
  /** YYYY-MM-DD */
  due?: string;
  /** fieldGid → enum option gid | text | number. */
  fields?: Record<string, string | number>;
}

export interface BuildRequest {
  title: string;
  fieldGids: string[];
  sections: Array<{ name: string; tasks: BuildTask[] }>;
}

export interface ApplyTask extends BuildTask {
  /** Present when the task already exists in the project → update instead of create. */
  gid?: string;
}

export interface ApplyRequest {
  projectGid: string;
  /** New project name, pushed when provided. */
  title?: string;
  fieldGids: string[];
  sections: Array<{
    gid?: string;
    name: string;
    /** True when the section's name actually changed (skip the PUT otherwise). */
    rename?: boolean;
    tasks: ApplyTask[];
    /** Full task-gid sequence — present when the section needs reordering. */
    orderedGids?: string[];
  }>;
  /** Deleted locally → deleted in Asana. */
  deleteTaskGids?: string[];
  deleteSectionGids?: string[];
  /** Reposition sections to match the request's section order. */
  reorderSections?: boolean;
}

export interface BuildProgress {
  runId: string;
  phase: 'starting' | 'project' | 'sections' | 'tasks' | 'done' | 'failed';
  total: number;
  done: number;
  errors: string[];
  warnings: string[];
  projectUrl?: string;
  projectGid?: string;
}

const runs = new Map<string, BuildProgress>();
const MANIFEST_DIR = path.resolve('data', 'manifests');
mkdirSync(MANIFEST_DIR, { recursive: true });

export function getRun(runId: string): BuildProgress | undefined {
  return runs.get(runId);
}

function saveManifest(progress: BuildProgress, request?: BuildRequest) {
  try {
    writeFileSync(
      path.join(MANIFEST_DIR, `${progress.runId}.json`),
      JSON.stringify({ progress, request }, null, 2),
    );
  } catch {
    // manifest is best-effort
  }
}

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

export function startBuild(request: BuildRequest): string {
  const runId = `run-${Date.now().toString(36)}`;
  const progress: BuildProgress = {
    runId,
    phase: 'starting',
    // 1 create per task + 1 section-assignment per task, + 1 per section
    total: request.sections.reduce((n, s) => n + s.tasks.length * 2, 0) + request.sections.length,
    done: 0,
    errors: [],
    warnings: [],
  };
  runs.set(runId, progress);
  saveManifest(progress, request);

  void (async () => {
    try {
      // Workspace (env override, else the token's first workspace).
      let workspaceGid = process.env.ASANA_WORKSPACE_GID;
      if (!workspaceGid) {
        const me = await asanaFetch('/users/me?opt_fields=workspaces');
        workspaceGid = me.data.workspaces?.[0]?.gid;
      }
      if (!workspaceGid) throw new Error('No workspace available for this token');

      // Organizations require a team for new projects.
      progress.phase = 'project';
      const ws = await asanaFetch(`/workspaces/${workspaceGid}`);
      let teamGid = process.env.ASANA_TEAM_GID;
      if (ws.data.is_organization && !teamGid) {
        const teams = await asanaFetch(`/organizations/${workspaceGid}/teams?limit=1`);
        teamGid = teams.data?.[0]?.gid;
        if (teamGid) progress.warnings.push(`No ASANA_TEAM_GID set — using team "${teams.data[0].name}"`);
      }

      const projectBody: Record<string, unknown> = { name: request.title, workspace: workspaceGid };
      if (teamGid) projectBody.team = teamGid;
      const project = await asanaFetch('/projects', { method: 'POST', body: { data: projectBody } });
      const projectGid: string = project.data.gid;
      progress.projectGid = projectGid;
      progress.projectUrl = project.data.permalink_url;

      // Attach chosen custom fields to the project (non-fatal per field).
      for (const fieldGid of request.fieldGids) {
        try {
          await asanaFetch(`/projects/${projectGid}/addCustomFieldSetting`, {
            method: 'POST',
            body: { data: { custom_field: fieldGid } },
          });
        } catch (err) {
          progress.warnings.push(`Couldn't add field ${fieldGid} to the project: ${String(err)}`);
        }
      }

      // Sections, one by one to preserve order. Asana adds a default empty
      // section to every new project — rename and reuse it as our first
      // section instead of leaving a phantom behind.
      progress.phase = 'sections';
      const sectionGids: string[] = [];
      const preexisting = await asanaFetch(`/projects/${projectGid}/sections?limit=10`);
      const defaultSection = preexisting.data?.[0];
      for (let i = 0; i < request.sections.length; i++) {
        const section = request.sections[i];
        if (i === 0 && defaultSection) {
          await asanaFetch(`/sections/${defaultSection.gid}`, {
            method: 'PUT',
            body: { data: { name: section.name } },
          });
          sectionGids.push(defaultSection.gid);
        } else {
          const created = await asanaFetch(`/projects/${projectGid}/sections`, {
            method: 'POST',
            body: { data: { name: section.name } },
          });
          sectionGids.push(created.data.gid);
        }
        progress.done++;
        saveManifest(progress);
      }

      // Tasks: batch-create 10 at a time, then batch-assign to their section.
      progress.phase = 'tasks';
      for (let si = 0; si < request.sections.length; si++) {
        const sectionGid = sectionGids[si];
        for (const group of chunk(request.sections[si].tasks, 10)) {
          const createRes = await asanaFetch('/batch', {
            method: 'POST',
            body: {
              data: {
                actions: group.map(t => ({
                  method: 'post',
                  relative_path: '/tasks',
                  data: {
                    name: t.name,
                    projects: [projectGid],
                    completed: !!t.completed,
                    ...(t.due ? { due_on: t.due } : {}),
                    ...(t.fields && Object.keys(t.fields).length ? { custom_fields: t.fields } : {}),
                  },
                })),
              },
            },
          });
          const createdGids: Array<string | null> = createRes.data.map((r: any, i: number) => {
            if (r.status_code >= 400) {
              progress.errors.push(`Create "${group[i].name}": ${r.body?.errors?.[0]?.message ?? r.status_code}`);
              return null;
            }
            return r.body.data.gid as string;
          });
          progress.done += group.length;

          const moves = createdGids.filter(Boolean) as string[];
          if (moves.length) {
            const moveRes = await asanaFetch('/batch', {
              method: 'POST',
              body: {
                data: {
                  actions: moves.map(gid => ({
                    method: 'post',
                    relative_path: `/sections/${sectionGid}/addTask`,
                    data: { task: gid },
                  })),
                },
              },
            });
            moveRes.data.forEach((r: any) => {
              if (r.status_code >= 400) {
                progress.errors.push(`Move to "${request.sections[si].name}": ${r.body?.errors?.[0]?.message ?? r.status_code}`);
              }
            });
          }
          progress.done += group.length;
          saveManifest(progress);
        }
      }

      progress.phase = 'done';
      saveManifest(progress);
    } catch (err) {
      progress.phase = 'failed';
      progress.errors.push(String(err));
      saveManifest(progress);
    }
  })();

  return runId;
}

/**
 * Apply staging to an EXISTING project: update tasks that have gids (name,
 * completion, due, fields, section), create the rest. Never deletes anything.
 */
export function startApply(request: ApplyRequest): string {
  const runId = `run-${Date.now().toString(36)}`;
  const deleteTaskGids = [...new Set(request.deleteTaskGids ?? [])];
  const deleteSectionGids = [...new Set(request.deleteSectionGids ?? [])];
  const progress: BuildProgress = {
    runId,
    phase: 'starting',
    // per task: 1 update-or-create + 1 section assignment; +1 per section; +deletions
    total:
      request.sections.reduce(
        (n, s) => n + s.tasks.length * 2 + (s.orderedGids?.length ?? 0),
        0,
      ) +
      request.sections.length +
      (request.reorderSections ? Math.max(0, request.sections.length - 1) : 0) +
      deleteTaskGids.length +
      deleteSectionGids.length,
    done: 0,
    errors: [],
    warnings: [],
  };
  runs.set(runId, progress);
  saveManifest(progress, request as unknown as BuildRequest);

  void (async () => {
    try {
      const projectGid = request.projectGid;
      progress.projectGid = projectGid;
      progress.phase = 'project';
      let project;
      if (request.title) {
        try {
          project = await asanaFetch(`/projects/${projectGid}`, {
            method: 'PUT',
            body: { data: { name: request.title } },
          });
        } catch (err) {
          // No permission to rename someone else's project — keep going, the
          // task-level changes may still be allowed.
          progress.warnings.push(
            `Couldn't rename the project (no permission?) — continuing: ${String(err).slice(0, 120)}`,
          );
        }
      }
      if (!project) project = await asanaFetch(`/projects/${projectGid}?opt_fields=permalink_url`);
      progress.projectUrl = project.data.permalink_url;

      for (const fieldGid of request.fieldGids) {
        try {
          await asanaFetch(`/projects/${projectGid}/addCustomFieldSetting`, {
            method: 'POST',
            body: { data: { custom_field: fieldGid } },
          });
        } catch {
          // usually "already on this project" — fine
        }
      }

      // Sections: rename existing, create missing (order = staging order for new ones).
      progress.phase = 'sections';
      const sectionGids: string[] = [];
      for (const section of request.sections) {
        if (section.gid) {
          if (section.rename) {
            try {
              await asanaFetch(`/sections/${section.gid}`, {
                method: 'PUT',
                body: { data: { name: section.name } },
              });
            } catch (err) {
              progress.warnings.push(`Couldn't rename section "${section.name}": ${String(err).slice(0, 120)}`);
            }
          }
          sectionGids.push(section.gid);
        } else {
          const created = await asanaFetch(`/projects/${projectGid}/sections`, {
            method: 'POST',
            body: { data: { name: section.name } },
          });
          sectionGids.push(created.data.gid);
        }
        progress.done++;
        saveManifest(progress);
      }

      // Reposition sections to match the staging order.
      if (request.reorderSections) {
        for (let i = 1; i < sectionGids.length; i++) {
          try {
            await asanaFetch(`/projects/${projectGid}/sections/insert`, {
              method: 'POST',
              body: { data: { section: sectionGids[i], after_section: sectionGids[i - 1] } },
            });
          } catch (err) {
            progress.warnings.push(`Couldn't move a section: ${String(err).slice(0, 100)}`);
          }
          progress.done++;
        }
        saveManifest(progress);
      }

      // Tasks: batch update-or-create, then batch section assignment (moves).
      progress.phase = 'tasks';
      for (let si = 0; si < request.sections.length; si++) {
        const sectionGid = sectionGids[si];
        for (const group of chunk(request.sections[si].tasks, 10)) {
          const res = await asanaFetch('/batch', {
            method: 'POST',
            body: {
              data: {
                actions: group.map(t => {
                  const data = {
                    name: t.name,
                    completed: !!t.completed,
                    due_on: t.due ?? null,
                    ...(t.fields && Object.keys(t.fields).length ? { custom_fields: t.fields } : {}),
                  };
                  return t.gid
                    ? { method: 'put', relative_path: `/tasks/${t.gid}`, data }
                    : {
                        method: 'post',
                        relative_path: '/tasks',
                        data: { ...data, projects: [projectGid] },
                      };
                }),
              },
            },
          });
          const gids: Array<string | null> = res.data.map((r: any, i: number) => {
            if (r.status_code >= 400) {
              progress.errors.push(
                `${group[i].gid ? 'Update' : 'Create'} "${group[i].name}": ${r.body?.errors?.[0]?.message ?? r.status_code}`,
              );
              return null;
            }
            return group[i].gid ?? (r.body.data.gid as string);
          });
          progress.done += group.length;

          const moves = gids.filter(Boolean) as string[];
          if (moves.length) {
            const moveRes = await asanaFetch('/batch', {
              method: 'POST',
              body: {
                data: {
                  actions: moves.map(gid => ({
                    method: 'post',
                    relative_path: `/sections/${sectionGid}/addTask`,
                    data: { task: gid },
                  })),
                },
              },
            });
            moveRes.data.forEach((r: any) => {
              if (r.status_code >= 400) {
                progress.errors.push(
                  `Move to "${request.sections[si].name}": ${r.body?.errors?.[0]?.message ?? r.status_code}`,
                );
              }
            });
          }
          progress.done += group.length;
          saveManifest(progress);
        }

        // Reorder: re-place every task in sequence (insert_after chains).
        const order = request.sections[si].orderedGids;
        if (order?.length) {
          let prev: string | null = null;
          for (const gid of order) {
            try {
              await asanaFetch(`/sections/${sectionGid}/addTask`, {
                method: 'POST',
                body: { data: { task: gid, ...(prev ? { insert_after: prev } : {}) } },
              });
            } catch (err) {
              progress.warnings.push(`Reorder in "${request.sections[si].name}": ${String(err).slice(0, 100)}`);
            }
            prev = gid;
            progress.done++;
          }
          saveManifest(progress);
        }
      }

      // Deletions last: tasks first (batched), then now-empty sections.
      for (const group of chunk(deleteTaskGids, 10)) {
        const res = await asanaFetch('/batch', {
          method: 'POST',
          body: {
            data: {
              actions: group.map(gid => ({ method: 'delete', relative_path: `/tasks/${gid}` })),
            },
          },
        });
        res.data.forEach((r: any, i: number) => {
          if (r.status_code >= 400 && r.status_code !== 404) {
            progress.errors.push(`Delete task ${group[i]}: ${r.body?.errors?.[0]?.message ?? r.status_code}`);
          }
        });
        progress.done += group.length;
        saveManifest(progress);
      }
      for (const gid of deleteSectionGids) {
        try {
          await asanaFetch(`/sections/${gid}`, { method: 'DELETE' });
        } catch (err) {
          const msg = String(err);
          // Already gone or not empty — surface only real problems.
          if (!msg.includes('404')) {
            progress.warnings.push(`Couldn't delete a section (it may not be empty): ${msg.slice(0, 120)}`);
          }
        }
        progress.done++;
        saveManifest(progress);
      }

      progress.phase = 'done';
      saveManifest(progress);
    } catch (err) {
      progress.phase = 'failed';
      progress.errors.push(String(err));
      saveManifest(progress);
    }
  })();

  return runId;
}
