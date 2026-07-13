import { BarChart3, HelpCircle, LayoutGrid, Settings } from "lucide-react";

export type View = "home" | "insights";

interface Props {
  view: View;
  onNavigate: (view: View) => void;
  onOpenSettings: () => void;
}

function RailButton({
  active,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
        active
          ? "bg-teal/10 text-teal"
          : "text-ink-soft hover:bg-cream-dark hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

export default function Sidebar({ view, onNavigate, onOpenSettings }: Props) {
  return (
    <nav className="flex h-full w-16 flex-col items-center border-r border-cream-dark bg-cream py-4">
      <div className="mb-6 flex h-10 w-10 items-center justify-center rounded-xl bg-teal font-display text-lg font-bold text-white">
        F
      </div>
      <div className="flex flex-col gap-2">
        <RailButton
          title="Home"
          active={view === "home"}
          onClick={() => onNavigate("home")}
        >
          <LayoutGrid size={20} />
        </RailButton>
        <RailButton
          title="Insights"
          active={view === "insights"}
          onClick={() => onNavigate("insights")}
        >
          <BarChart3 size={20} />
        </RailButton>
      </div>
      <div className="mt-auto flex flex-col gap-2">
        <RailButton title="Settings" onClick={onOpenSettings}>
          <Settings size={20} />
        </RailButton>
        <RailButton
          title="Help — hold your hotkey in any text field and speak"
          onClick={() => onNavigate("home")}
        >
          <HelpCircle size={20} />
        </RailButton>
      </div>
    </nav>
  );
}
