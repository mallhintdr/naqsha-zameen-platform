import React, { useEffect, useRef } from 'react';
import { useMap } from './mapContext';
import { useNavigate } from 'react-router';
import L from 'leaflet';
import { UserPlus as FaUserPlus, UserPen as FaUserEdit, Users as FaUsers, ChartColumn as FaChartBar, UserCog as FaUserTie } from 'lucide-react';
import './css/AdminToolbar.css';

const AdminToolbar = ({ user }) => {
  const map = useMap();
  const navigate = useNavigate();
  const containerRef = useRef(null);

  useEffect(() => {
    if (containerRef.current) {
      L.DomEvent.disableClickPropagation(containerRef.current);
      L.DomEvent.disableScrollPropagation(containerRef.current);
    }
  });

  if (user?.userType === 'subadmin') {
    const items = [
      ['/subadmin/users?new=1', FaUserPlus, 'New Customer', 'btn-register'],
      ['/subadmin/users', FaUserEdit, 'My Customers', 'btn-manage'],
      ['/subadmin/users?tab=awaiting', FaUsers, 'Awaiting Activation', 'btn-public-users'],
      ['/subadmin', FaChartBar, 'Dashboard & Bills', 'btn-insights']
    ];
    return (
      <div className="admin-toolbar-container" ref={containerRef}>
        {items.map(([to, Icon, label, cls]) => (
          <button key={to} className={`admin-toolbar-btn ${cls}`} onClick={() => navigate(to)} title={label} aria-label={label}>
            <Icon className="admin-toolbar-icon" />
            <span className="admin-toolbar-tooltip">{label}</span>
          </button>
        ))}
      </div>
    );
  }

  if (user?.userType !== 'admin') {
    return null;
  }

  return (
    <div className="admin-toolbar-container" ref={containerRef}>
      <button 
        className="admin-toolbar-btn btn-register" 
        onClick={() => navigate('/admin/register')}
        title="Register User"
        aria-label="Register User"
      >
        <FaUserPlus className="admin-toolbar-icon" />
        <span className="admin-toolbar-tooltip">Register User</span>
      </button>
      <button 
        className="admin-toolbar-btn btn-public-users" 
        onClick={() => navigate('/users?tab=publicRegistration')}
        title="Publicly Registered Users"
        aria-label="Publicly Registered Users"
      >
        <FaUsers className="admin-toolbar-icon" />
        <span className="admin-toolbar-tooltip">Public Users</span>
      </button>
      <button 
        className="admin-toolbar-btn btn-insights" 
        onClick={() => navigate('/stats')}
        title="Insights / Analytics"
        aria-label="Insights / Analytics"
      >
        <FaChartBar className="admin-toolbar-icon" />
        <span className="admin-toolbar-tooltip">Insights</span>
      </button>
      <button
        className="admin-toolbar-btn btn-subadmins"
        onClick={() => navigate('/admin/subadmins')}
        title="Sub-admins"
        aria-label="Sub-admins"
      >
        <FaUserTie className="admin-toolbar-icon" />
        <span className="admin-toolbar-tooltip">Sub-admins</span>
      </button>
    </div>
  );
};

export default AdminToolbar;
