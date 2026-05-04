import { Outlet, NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Home, PieChart, Settings, PlusCircle, ArrowRightLeft } from 'lucide-react';
import { cn } from '../lib/utils';

const T = {
  home: '\u9996\u9801',
  stats: '\u7d71\u8a08',
  receipt: '\u6536\u64da',
  exchange: '\u63db\u532f',
  settings: '\u8a2d\u5b9a'
};

export function Layout() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <main className="flex-1 pb-20">
        <Outlet />
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-divider px-6 py-4 pb-safe z-[100]">
        <div className="max-w-md mx-auto flex justify-between items-center relative">
          <NavItem to="/" icon={<Home className="w-7 h-7" />} label={T.home} />
          <NavItem to="/dashboard" icon={<PieChart className="w-7 h-7" />} label={T.stats} />

          <NavLink to="/receipt/new" className="flex flex-col items-center gap-1 -mt-12">
            <div className="bg-primary-blue text-white p-5 rounded-full shadow-[0_8px_20px_rgba(155,187,214,0.4)] active:scale-95 transition-all border-4 border-white">
              <PlusCircle className="w-9 h-9" />
            </div>
            <span className="text-[10px] font-bold text-ink/30 mt-1">{T.receipt}</span>
          </NavLink>

          <NavItem to="/transfer" icon={<ArrowRightLeft className="w-7 h-7" />} label={T.exchange} />
          <NavItem to="/settings" icon={<Settings className="w-7 h-7" />} label={T.settings} />
        </div>
      </nav>
    </div>
  );
}

function NavItem({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn('flex flex-col items-center gap-1 text-[10px] font-bold transition-all', isActive ? 'text-primary-blue' : 'text-ink/30')
      }
    >
      {icon}
      <span>{label}</span>
    </NavLink>
  );
}
