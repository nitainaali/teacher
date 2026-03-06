import { NavLink, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

interface NavItem {
  icon: string;
  key: string;
  path: string;
  expandable?: boolean;
  subItems?: SubItem[];
}

interface SubItem {
  icon: string;
  key: string;
  path: string;
}

export function CourseSidebar() {
  const { t } = useTranslation();
  const { courseId } = useParams<{ courseId: string }>();
  const location = useLocation();

  if (!courseId) return null;

  const isLearningOpen = location.pathname.includes(`/course/${courseId}/learning`);

  const navItems: NavItem[] = [
    {
      icon: "📚",
      key: "sidebar.knowledge",
      path: `/course/${courseId}/knowledge`,
    },
    {
      icon: "📖",
      key: "sidebar.learning",
      path: `/course/${courseId}/learning`,
      expandable: true,
      subItems: [
        {
          icon: "📄",
          key: "sidebar.summary",
          path: `/course/${courseId}/learning/summary`,
        },
        {
          icon: "🃏",
          key: "sidebar.flashcards",
          path: `/course/${courseId}/learning/flashcards`,
        },
        {
          icon: "❓",
          key: "sidebar.quizzes",
          path: `/course/${courseId}/learning/quizzes`,
        },
      ],
    },
    {
      icon: "💬",
      key: "sidebar.chat",
      path: `/course/${courseId}/chat`,
    },
    {
      icon: "📝",
      key: "sidebar.homework",
      path: `/course/${courseId}/homework`,
    },
    {
      icon: "📊",
      key: "sidebar.exam",
      path: `/course/${courseId}/exam`,
    },
    {
      icon: "🔍",
      key: "sidebar.diagnosis",
      path: `/course/${courseId}/diagnosis`,
    },
  ];

  const activeClass =
    "bg-blue-600/20 text-blue-400 font-medium";
  const inactiveClass =
    "text-gray-400 hover:text-white hover:bg-gray-700";

  return (
    <aside className="w-52 shrink-0 bg-gray-800 border-r border-gray-700 h-full flex flex-col overflow-y-auto">
      <nav className="flex-1 py-2">
        {navItems.map((item) => (
          <div key={item.path}>
            <NavLink
              to={item.path}
              end={!item.expandable}
              className={({ isActive }) =>
                `flex items-center gap-2 px-4 py-2.5 text-sm transition-colors ${
                  isActive ? activeClass : inactiveClass
                }`
              }
            >
              <span className="text-base leading-none">{item.icon}</span>
              <span>{t(item.key)}</span>
            </NavLink>

            {/* Sub-items for expandable sections */}
            {item.expandable && item.subItems && isLearningOpen && (
              <div className="flex flex-col">
                {item.subItems.map((sub) => (
                  <NavLink
                    key={sub.path}
                    to={sub.path}
                    className={({ isActive }) =>
                      `flex items-center gap-2 pl-8 pr-4 py-2 text-xs transition-colors ${
                        isActive ? activeClass : inactiveClass
                      }`
                    }
                  >
                    <span className="text-sm leading-none">{sub.icon}</span>
                    <span>{t(sub.key)}</span>
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>
    </aside>
  );
}
