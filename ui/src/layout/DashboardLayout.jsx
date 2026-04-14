import Header from './Header.jsx';
import LeftSidebar from './LeftSidebar.jsx';
import RightSidebar from './RightSidebar.jsx';

export default function DashboardLayout({ children }) {
  return (
    <div className="dashboard">
      <Header />
      <div className="dashboard-body">
        <LeftSidebar />
        <main className="dashboard-center">{children}</main>
        <RightSidebar />
      </div>
    </div>
  );
}
