import type { CSSProperties } from 'react';

interface AvatarProps {
  avatarUrl?: string | null;
  preset?: string;
  size?: number;
  className?: string;
  ring?: string;
}

export function Avatar({ avatarUrl, preset = '🦊', size = 48, className = '', ring }: AvatarProps) {
  const style: CSSProperties = {
    width: size,
    height: size,
    fontSize: Math.round(size * 0.46),
    ...(ring ? { boxShadow: `0 0 0 2px ${ring}` } : {})
  };
  return (
    <div className={`avatar ${className}`} style={style} aria-hidden="true">
      {avatarUrl ? <img src={avatarUrl} alt="" loading="lazy" /> : <span>{preset}</span>}
    </div>
  );
}
