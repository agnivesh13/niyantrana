/**
 * The product name: the logo mark, set beside the name in type.
 *
 * Only the icon is used, not the supplied lockup. The full artwork already
 * contains the word "Niyantrana" and the tagline, so placing it next to this
 * component's text would print the name twice — and at the 28px the header
 * gives it, the tagline is a smudge. The name stays as type, which also means
 * it stays selectable, searchable, and crisp at any zoom.
 *
 * Served from `/logo-mark.png` rather than imported, so the static privacy and
 * terms pages reference exactly the same file.
 */
import { Link } from 'react-router-dom';

import { cn } from '../lib/utils.js';

export default function Wordmark({ to = '/', className, subdued = false }) {
  const content = (
    <span className={cn('inline-flex items-center gap-2 font-semibold tracking-tight', className)}>
      <img
        src="/logo-mark.png"
        // The name is right beside it, so the image is decoration and repeating
        // it would make a screen reader say "Niyantrana Niyantrana".
        alt=""
        aria-hidden
        width={28}
        height={28}
        className="size-7 shrink-0"
      />
      <span className={cn('text-lg', subdued ? 'text-secondary' : 'text-primary')}>
        Niyantrana
      </span>
    </span>
  );

  return to ? <Link to={to} className="rounded-lg">{content}</Link> : content;
}
