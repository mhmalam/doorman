// Asana REST client: token from env only, rate limiting, Retry-After handling,
// pagination. The client app never sees the token.

const BASE = 'https://app.asana.com/api/1.0';

// Free-tier limit ~150 req/min; stay under it with a simple sliding window.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 140;
const recent: number[] = [];

async function throttle(): Promise<void> {
  const now = Date.now();
  while (recent.length && recent[0] < now - WINDOW_MS) recent.shift();
  if (recent.length >= MAX_PER_WINDOW) {
    const waitMs = recent[0] + WINDOW_MS - now;
    await new Promise(res => setTimeout(res, waitMs));
    return throttle();
  }
  recent.push(now);
}

export class AsanaError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`Asana ${status}: ${JSON.stringify(body)}`);
  }
}

export async function asanaFetch(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<any> {
  const token = process.env.ASANA_TOKEN;
  if (!token) throw new AsanaError(500, { errors: [{ message: 'ASANA_TOKEN is not set on the server' }] });

  await throttle();
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After') ?? '5');
    await new Promise(r => setTimeout(r, retryAfter * 1000));
    return asanaFetch(path, init);
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new AsanaError(res.status, json);
  return json;
}

/** GET with pagination: follows next_page.uri until exhausted. */
export async function asanaFetchAll(path: string): Promise<any[]> {
  const items: any[] = [];
  let url: string | null = path;
  while (url) {
    const page = await asanaFetch(url);
    items.push(...(page.data ?? []));
    url = page.next_page?.uri ?? null;
  }
  return items;
}

const TASK_OPT_FIELDS =
  'name,completed,assignee,due_on,resource_subtype,' +
  'memberships.project.gid,memberships.section.gid,memberships.section.name,custom_fields';

/** Full project state capture: sections in order, all tasks with fields, and
 *  the project's custom-field settings (so the client can show the columns). */
export async function snapshotProject(projectGid: string) {
  const [project, sections, tasks, settings] = await Promise.all([
    asanaFetch(`/projects/${projectGid}?opt_fields=name,permalink_url`),
    asanaFetchAll(`/projects/${projectGid}/sections?limit=100&opt_fields=name`),
    asanaFetchAll(`/projects/${projectGid}/tasks?limit=100&opt_fields=${TASK_OPT_FIELDS}`),
    asanaFetchAll(
      `/projects/${projectGid}/custom_field_settings?limit=100&opt_fields=custom_field.name,custom_field.resource_subtype,custom_field.enum_options.name,custom_field.enum_options.color`,
    ).catch(() => [] as any[]),
  ]);
  return {
    capturedAt: new Date().toISOString(),
    project: project.data,
    sections,
    fields: settings
      .map((s: any) => s.custom_field)
      .filter(Boolean)
      .map((f: any) => ({
        gid: f.gid,
        name: f.name,
        type: f.resource_subtype,
        enum_options: f.enum_options?.map((o: any) => ({ gid: o.gid, name: o.name, color: o.color })),
      })),
    // Skip section/milestone subtypes when treating tasks as rooms.
    tasks: tasks.filter(
      (t: any) => !['section', 'milestone'].includes(t.resource_subtype),
    ),
  };
}
