/**
 * The product name, set as type rather than shipped as an asset.
 *
 * The old build referenced `/logo.svg`, which was never added to the repo, so
 * the login screen rendered a broken image. A wordmark cannot 404.
 */
import { Link } from 'react-router-dom';

import { cn } from '../lib/utils.js';

export default function Wordmark({ to = '/', className, subdued = false }) {
  const content = (
    <span className={cn('inline-flex items-baseline gap-1.5 font-semibold tracking-tight', className)}>
      <span className="grid size-7 place-items-center rounded-lg bg-accent text-[0.9375rem] font-bold text-white">
        N
      </span>
      <span className={cn('text-lg', subdued ? 'text-secondary' : 'text-primary')}>
        Niyantrana
      </span>
    </span>
  );

  return to ? <Link to={to} className="rounded-lg">{content}</Link> : content;
}
