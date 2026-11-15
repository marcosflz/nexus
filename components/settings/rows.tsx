export function SettingsSectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-8 text-[22px] font-medium tracking-tight">{children}</h2>;
}

export function SettingsGroup({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      {title ? <h3 className="mb-3 text-[17px] font-medium">{title}</h3> : null}
      <div className="divide-border border-border bg-surface divide-y rounded-xl border">{children}</div>
    </section>
  );
}

export function SettingsRow({
  label,
  description,
  children,
  htmlFor,
}: {
  label: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="block text-[15px] font-medium">
          {label}
        </label>
        {description ? <p className="text-muted-fg mt-0.5 text-[13px]">{description}</p> : null}
      </div>
      {children ? <div className="shrink-0 sm:max-w-[60%]">{children}</div> : null}
    </div>
  );
}
