import Image from 'next/image';
import Link from 'next/link';

export function BrandLogo({
  href = '/',
  size = 'small',
}: {
  href?: string;
  size?: 'small' | 'large';
}) {
  const dimension = size === 'large' ? 96 : 58;

  return (
    <Link
      href={href}
      aria-label="Lumi, powered by Danny"
      className="brand-lockup inline-flex shrink-0 flex-col items-center gap-1"
    >
      <Image
        src="/lumi-logo.jpg"
        alt="Lumi"
        width={dimension}
        height={dimension}
        priority
        className={`brand-image ${size === 'large' ? 'rounded-[1.6rem]' : 'rounded-2xl'}`}
      />
      <span className="brand-byline">Powered by Danny</span>
    </Link>
  );
}
