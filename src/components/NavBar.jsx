import { NavLink } from 'react-router-dom';

export default function NavBar() {
  return (
    <nav className="nav-bar">
      <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
        <span className="nav-icon" aria-hidden="true">
          🏋️
        </span>
        Today
      </NavLink>
      <NavLink to="/trends" className={({ isActive }) => (isActive ? 'active' : '')}>
        <span className="nav-icon" aria-hidden="true">
          📈
        </span>
        Trends
      </NavLink>
      <NavLink to="/settings" className={({ isActive }) => (isActive ? 'active' : '')}>
        <span className="nav-icon" aria-hidden="true">
          ⚙️
        </span>
        Settings
      </NavLink>
    </nav>
  );
}
