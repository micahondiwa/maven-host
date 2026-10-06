export const contactFields = [
  ['first_name', 'First name', 'given-name'], ['last_name', 'Last name', 'family-name'],
  ['organization', 'Organization (optional)', 'organization'], ['email', 'Contact email', 'email'],
  ['address1', 'Street', 'address-line1'], ['street_number', 'Building or street number', 'off'],
  ['address2', 'Address line 2 (optional)', 'address-line2'], ['city', 'City', 'address-level2'],
  ['state', 'State or county', 'address-level1'], ['postal_code', 'Postal code', 'postal-code'],
  ['country', 'Country code (e.g. KE)', 'country'], ['phone_country_code', 'Phone country code (e.g. 254)', 'tel-country-code'],
  ['phone_area_code', 'Area or mobile prefix (e.g. 700)', 'tel-area-code'],
  ['phone_subscriber_number', 'Remaining phone digits', 'tel-local'],
] as const

export function validateDomainContact(contact: Record<string, string>): string | null {
  if (contactFields.some(([key]) => key !== 'organization' && key !== 'address2' && !contact[key]?.trim()))
    return 'Complete the domain registration contact details before checkout.'
  if (!/^[A-Za-z]{2}$/.test(contact.country) || ['phone_country_code', 'phone_area_code', 'phone_subscriber_number'].some(key => !/^\d+$/.test(contact[key])))
    return 'Use a two-letter country code and numbers only in the phone fields.'
  return null
}

export function DomainContactFields({ value, onChange }: { value: Record<string, string>; onChange: (value: Record<string, string>) => void }) {
  return (
    <fieldset className="mt-6 border-t border-maven-line pt-5">
      <legend className="font-semibold text-maven-ink">Domain registration contact</legend>
      <p className="mt-2 text-xs leading-5 text-maven-muted">Use accurate details for the domain owner. These details apply to all domains in this order and are shared with the registrar as required by registry rules.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {contactFields.map(([key, label, autocomplete]) => (
          <div key={key}>
            <label htmlFor={`domain-contact-${key}`} className="label">{label}</label>
            <input id={`domain-contact-${key}`} type={key === 'email' ? 'email' : 'text'} autoComplete={autocomplete}
              maxLength={key === 'country' ? 2 : 255} inputMode={key.startsWith('phone_') ? 'numeric' : undefined}
              value={value[key] ?? ''} onChange={event => onChange({ ...value, [key]: event.target.value })} className="field mt-1.5" />
          </div>
        ))}
      </div>
    </fieldset>
  )
}
