'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Radio,
  FileText,
  Users,
  HardDrive,
  LogOut,
  Shield,
  Loader2,
  Plus,
  BarChart3,
  UserCheck,
  MessageSquare,
  Calendar,
  Video,
  Share2,
  Activity,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  Captions,
  Cpu,
  Trash2,
  CalendarDays,
  Images,
  History,
  Lock,
  DatabaseBackup,
} from 'lucide-react';
import CommandPalette from '@/components/dashboard/CommandPalette';
import {
  PermissionMap,
  PermissionSection,
  can,
  sectionForPage,
  sectionLabel,
} from '@/lib/permissions';

interface UserSession {
  id: string;
  name: string;
  email: string;
  picture?: string;
  role: 'admin' | 'owner' | 'editor' | 'user';
  permissions: PermissionMap;
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Hidden unless the user has at least read access on this section. */
  section?: PermissionSection;
  /** Hidden unless the user's role is in this list. Bypasses the permission matrix entirely — for role-hardcoded, non-overridable entries. */
  roles?: ('admin' | 'owner')[];
  isPopUp?: boolean;
  action?: () => void;
}

const YoutubeIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
  </svg>
);

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const saved = localStorage.getItem('sidebar_collapsed');
    if (saved !== null) {
      setCollapsed(saved === 'true');
    }
    const savedCats = localStorage.getItem('sidebar_collapsed_categories');
    if (savedCats) {
      try {
        setCollapsedCategories(JSON.parse(savedCats));
      } catch {}
    }
  }, []);

  const toggleCollapse = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('sidebar_collapsed', String(next));
      return next;
    });
  };

  const toggleCategory = (title: string) => {
    setCollapsedCategories((prev) => {
      const next = { ...prev, [title]: !prev[title] };
      localStorage.setItem('sidebar_collapsed_categories', JSON.stringify(next));
      return next;
    });
  };

  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) {
          router.push('/login');
          return;
        }

        const data = await res.json();
        if (!data.user) {
          router.push('/login');
          return;
        }

        if (data.user.role !== 'admin' && data.user.role !== 'owner' && data.user.role !== 'editor') {
          router.push('/unauthorized');
          return;
        }

        setUser(data.user);
      } catch {
        router.push('/login');
      } finally {
        setLoading(false);
      }
    }

    checkAuth();
  }, [router]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center text-zinc-400 gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
        <span className="text-xs font-mono">Cargando panel...</span>
      </div>
    );
  }

  const allNavGroups: { title: string; items: NavItem[] }[] = [
    {
      title: 'General',
      items: [
        { label: 'Visión General', href: '/', icon: LayoutDashboard },
        { label: 'En Vivo', href: '/live', icon: Activity, section: 'live' },
        { label: 'Calendario', href: '/calendar', icon: CalendarDays, section: 'episodes' },
      ],
    },
    {
      title: 'Contenido & Redes',
      items: [
        { label: 'Episodios', href: '/episodes', icon: Radio, section: 'episodes' },
        { label: 'Blog', href: '/blog', icon: FileText, section: 'blog' },
        { label: 'Galería', href: '/gallery', icon: Images, section: 'gallery' },
        { label: 'YouTube Studio', href: '/youtube', icon: YoutubeIcon, section: 'youtube' },
        { label: 'Highlights Studio', href: '/social-clips', icon: Video, section: 'social' },
        { label: 'Social Publisher', href: '/buffer', icon: Share2, section: 'social' },
        { label: 'Buckets R2', href: '/admin/buckets', icon: HardDrive, section: 'buckets' },
      ],
    },
    {
      title: 'Comunidad & Gestión',
      items: [
        { label: 'Usuarios', href: '/users', icon: Users, section: 'users' },
        { label: 'Comentarios', href: '/comments', icon: MessageSquare, section: 'comments' },
        { label: 'Entrevistas', href: '/interviews', icon: Calendar, section: 'interviews' },
        { label: 'Invitados', href: '/guests', icon: UserCheck, section: 'guests' },
        { label: 'Equipo', href: '/team', icon: Users, section: 'team' },
        { label: 'Papelera', href: '/trash', icon: Trash2, section: 'trash' },
        { label: 'Copias de Seguridad', href: '/admin/backup', icon: DatabaseBackup, roles: ['admin', 'owner'] },
      ],
    },
    {
      title: 'Analíticas & API',
      items: [
        { label: 'Analíticas', href: '/user-stats', icon: BarChart3, section: 'analytics' },
        { label: 'Deepgram Admin', href: '/deepgram-stats', icon: Cpu, section: 'deepgram' },
        { label: 'Registro de Auditoría', href: '/admin/audit-log', icon: History, section: 'audit' },
        {
          label: 'Broslytics ↗',
          href: '#',
          icon: ExternalLink,
          section: 'analytics',
          isPopUp: true,
          action: () => {
            window.open(
              'https://analytics.broslunas.com/share/EbieAikRrucZqa03',
              'BroslyticsWindow',
              'width=1280,height=850,scrollbars=yes,resizable=yes'
            );
          },
        },
      ],
    },
  ];

  const navGroups = allNavGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          (!item.section || can(user?.permissions, item.section)) &&
          (!item.roles || (!!user?.role && item.roles.includes(user.role as 'admin' | 'owner')))
      ),
    }))
    .filter((group) => group.items.length > 0);

  const currentSection = sectionForPage(pathname);
  const sectionBlocked = currentSection ? !can(user?.permissions, currentSection) : false;

  return (
    <div className="h-screen overflow-hidden bg-zinc-950 text-zinc-100 flex flex-col md:flex-row">
      {/* COLLAPSIBLE INDEPENDENT SIDEBAR */}
      <aside
        className={`w-full ${
          collapsed ? 'md:w-16' : 'md:w-60'
        } h-auto md:h-screen md:sticky md:top-0 bg-zinc-900/60 border-r border-zinc-800/80 flex flex-col shrink-0 transition-all duration-300 relative z-20`}
      >
        {/* Brand Header */}
        <div className="p-3 border-b border-zinc-800/80 flex items-center justify-between min-h-[52px] shrink-0">
          <Link href="/" className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-xs shadow-md shadow-indigo-600/30 shrink-0">
              V
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <span className="font-bold text-xs text-zinc-100 block leading-tight truncate">
                  Veredillas FM
                </span>
                <span className="text-[9px] font-mono text-zinc-500 block uppercase">Panel Admin</span>
              </div>
            )}
          </Link>

          {!collapsed && user?.role && (
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 uppercase hidden lg:inline-block">
              {user.role}
            </span>
          )}

          {/* Toggle Button */}
          <button
            onClick={toggleCollapse}
            title={collapsed ? 'Expandir barra lateral' : 'Contraer barra lateral'}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 transition shrink-0 hidden md:flex items-center justify-center"
          >
            {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Quick Create Action */}
        <div className="p-2 shrink-0">
          <Link
            href="/episodes/new"
            title="Nuevo Episodio"
            className={`w-full bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-700/60 text-zinc-200 py-1.5 rounded-lg text-xs font-medium flex items-center justify-center gap-2 transition ${
              collapsed ? 'px-0' : 'px-2.5'
            }`}
          >
            <Plus className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            {!collapsed && <span className="text-xs">Nuevo Episodio</span>}
          </Link>
        </div>

        {/* Nav Links Grouped by Category - Independent Custom Scroll */}
        <nav className="flex-1 p-2 space-y-3 overflow-y-auto overflow-x-hidden select-none">
          {navGroups.map((group) => {
            const isCategoryCollapsed = collapsedCategories[group.title] ?? false;

            return (
              <div key={group.title} className="space-y-0.5">
                {!collapsed ? (
                  <button
                    onClick={() => toggleCategory(group.title)}
                    className="w-full flex items-center justify-between px-2 text-[9px] font-mono font-bold uppercase tracking-wider text-zinc-500 my-1 hover:text-zinc-300 transition group select-none text-left"
                    title={isCategoryCollapsed ? `Expandir ${group.title}` : `Contraer ${group.title}`}
                  >
                    <span className="truncate">{group.title}</span>
                    <ChevronDown
                      className={`w-3 h-3 text-zinc-600 group-hover:text-zinc-400 transition-transform duration-200 shrink-0 ${
                        isCategoryCollapsed ? '-rotate-90' : 'rotate-0'
                      }`}
                    />
                  </button>
                ) : (
                  <div className="border-t border-zinc-800/60 my-1.5 mx-1" />
                )}

                {(!isCategoryCollapsed || collapsed) &&
                  group.items.map((item) => {
                    const Icon = item.icon;
                    const isActive =
                      pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));

                    if (item.isPopUp) {
                      return (
                        <button
                          key={item.label}
                          onClick={item.action}
                          title={collapsed ? item.label : 'Abrir Broslytics en ventana emergente'}
                          className={`w-full flex items-center gap-2.5 rounded-lg text-xs font-semibold transition ${
                            collapsed ? 'p-2 justify-center' : 'px-2.5 py-1.5'
                          } text-purple-300 hover:text-white bg-purple-950/30 hover:bg-purple-900/50 border border-purple-800/40 text-left`}
                        >
                          <Icon className="w-3.5 h-3.5 shrink-0 text-purple-400" />
                          {!collapsed && <span className="truncate">{item.label}</span>}
                        </button>
                      );
                    }

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        title={collapsed ? item.label : undefined}
                        className={`flex items-center gap-2.5 rounded-lg text-xs font-medium transition ${
                          collapsed ? 'p-2 justify-center' : 'px-2.5 py-1.5'
                        } ${
                          isActive
                            ? 'bg-zinc-800 text-zinc-100 border border-zinc-700/50 shadow-sm font-semibold'
                            : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
                        }`}
                      >
                        <Icon
                          className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-indigo-400' : 'text-zinc-500'}`}
                        />
                        {!collapsed && <span className="truncate">{item.label}</span>}
                      </Link>
                    );
                  })}
              </div>
            );
          })}
        </nav>

        {/* User Footer */}
        <div className="p-2 border-t border-zinc-800/80 flex items-center justify-between gap-2 min-h-[48px] shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {user?.picture ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.picture}
                alt={user.name}
                className="w-6 h-6 rounded-full object-cover shrink-0"
              />
            ) : (
              <div className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center text-[10px] font-bold text-zinc-300 shrink-0">
                {user?.name?.charAt(0)}
              </div>
            )}
            {!collapsed && (
              <div className="min-w-0">
                <p className="text-xs font-medium text-zinc-200 truncate leading-tight">{user?.name}</p>
                <p className="text-[9px] text-zinc-500 truncate leading-tight">{user?.email}</p>
              </div>
            )}
          </div>

          <button
            onClick={handleLogout}
            title="Cerrar sesión"
            className="p-1 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded transition shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT AREA (INDEPENDENT SCROLL) */}
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto">
        {sectionBlocked && currentSection ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500">
              <Lock className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h2 className="text-base font-bold text-zinc-100">Sección restringida</h2>
              <p className="text-xs text-zinc-400 max-w-sm">
                Tu cuenta no tiene acceso a{' '}
                <span className="text-zinc-200 font-medium">{sectionLabel(currentSection)}</span>. Pide a un
                administrador que ajuste tus permisos si necesitas entrar.
              </p>
            </div>
            <Link
              href="/"
              className="text-xs font-medium text-indigo-400 hover:text-indigo-300 transition"
            >
              Volver a Visión General
            </Link>
          </div>
        ) : (
          children
        )}
      </main>

      <CommandPalette navGroups={navGroups} permissions={user?.permissions} />
    </div>
  );
}
