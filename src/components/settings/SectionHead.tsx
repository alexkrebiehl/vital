// A Settings card heading: an icon and a title.

export function SectionHead({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-5">
      {icon}
      <h2 className="text-base font-semibold text-text-primary">{title}</h2>
    </div>
  );
}
