import { ICONS, type IconName } from '../icons';

export function Icon({ name, size = 22, className = '' }: { name: IconName; size?: number; className?: string }) {
  return <span className={`icon ${className}`} style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: ICONS[name] }} />;
}
