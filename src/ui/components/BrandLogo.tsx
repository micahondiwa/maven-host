export function BrandLogo({ compact = false, footer = false, light = false }: { compact?: boolean; footer?: boolean; light?: boolean }) {
  const width = compact ? 'w-[148px] sm:w-[164px]' : footer ? 'w-[184px]' : 'w-[215px]'
  return (
    <span className={`inline-flex shrink-0 items-center ${light ? '' : 'rounded-lg bg-maven-ink px-3 py-2'}`} aria-label="MavenHost — Domains & Web Hosting">
      <img
        src={light ? '/brand/mavenhost-logo-reversed.svg?v=inara-20261004' : '/brand/mavenhost-logo.svg?v=inara-20261004'}
        alt="MavenHost — Domains & Web Hosting"
        width="551"
        height="104"
        className={`block h-auto ${width} object-contain`}
      />
    </span>
  )
}
