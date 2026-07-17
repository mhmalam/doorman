// The app icon tile — cycles through the field palette. All tiles share the
// same wall-clock-anchored phase, so navbar and page icons change together.

import { ListGlyph } from './icons';

export function BrandTile({
  size = 28,
  icon = 16,
  className = '',
}: {
  size?: number;
  icon?: number;
  className?: string;
}) {
  return (
    <span
      className={'brand-tile text-white flex items-center justify-center shrink-0 ' + className}
      style={{ width: size, height: size, animationDelay: `-${Date.now() % 12000}ms` }}
    >
      <ListGlyph size={icon} />
    </span>
  );
}
