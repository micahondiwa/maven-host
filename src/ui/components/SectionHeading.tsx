export function SectionHeading({ kicker, title, description, align = 'left' }: {
  kicker?: string
  title: string
  description?: string
  align?: 'left' | 'center'
}) {
  return (
    <div className={align === 'center' ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl'}>
      {kicker && (
        <p className={`mb-3 flex items-center gap-2 text-[13px] font-semibold text-maven-signal ${align === 'center' ? 'justify-center' : ''}`}>
          <span className="h-[2px] w-4 bg-maven-signal" /> {kicker}
        </p>
      )}
      <h2 className="text-[2rem] font-semibold tracking-tight text-maven-ink sm:text-[2.35rem]">{title}</h2>
      {description && <p className="mt-3.5 text-[15.5px] leading-7 text-maven-muted">{description}</p>}
    </div>
  )
}
