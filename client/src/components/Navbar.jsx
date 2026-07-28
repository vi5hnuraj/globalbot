import React, { useEffect, useState, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { close, menu } from "../assets";
import { navLinks } from "../constants";
import { FaUserCircle } from "react-icons/fa";
import Cookies from "js-cookie";
import api, { getCachedUserDetail, refreshUserCache, invalidateUserCache } from "../utils/api";
import QRScannerModal from "./QRScannerModal";
import QRPaymentModal from "./QRPaymentModal";

const Navbar = () => {
  const [active, setActive] = useState("Home");
  const [toggle, setToggle] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannedQRData, setScannedQRData] = useState(null);
  const [userData, setUserData] = useState({
    username: "",
    email: "",
    metamask: "",
    upi: "",
    bankDetails: {},
    kyc: false,
    mobile: "",
    age: "",
    dob: "",
    address: "",
    status: "",
  });
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const navigate = useNavigate();
  const dropdownRef = useRef(null);

  // Handle nav link click
  const handleNavLinkClick = (title) => {
    setActive(title);
    setToggle(false);
  };

  // Toggle user dropdown
  const toggleDropdown = () => setIsDropdownOpen(!isDropdownOpen);

  // Logout user
  const handleLogout = () => {
    localStorage.removeItem("token");
    setIsLoggedIn(false);
    navigate("/");
  };

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Check login on mount
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) setIsLoggedIn(true);
  }, []);

  // Fetch user details securely
  useEffect(() => {
    const fetchUser = async () => {
      const token = localStorage.getItem("token");
      if (!token) return;

      try {
        const user = await getCachedUserDetail();
        setUserData(user || {});
        refreshUserCache().then(fresh => { if (fresh) setUserData(fresh); });
      } catch (error) {
        invalidateUserCache();
        console.error("Failed to fetch user details:", error.response?.data || error.message);

        if (error.response?.status === 401) handleLogout();
      }
    };

    if (isLoggedIn) fetchUser();
  }, [isLoggedIn]);

  return (
    <nav className="w-full flex py-6 justify-between items-center navbar px-6 relative">
      {/* Logo */}
      <h1
        onClick={() => (window.location.href = "/")}
        className="w-auto h-[38px] text-4xl text-gradient font-extrabold cursor-pointer"
      >
        GlobalPay
      </h1>

      {/* Desktop nav links */}
      <ul className="list-none sm:flex hidden justify-end items-center flex-1 space-x-8">
        {isLoggedIn && (
          <>
            {navLinks.map((nav) => (
              <li
                key={nav.id}
                className={`font-poppins font-normal cursor-pointer text-[16px] ${active === nav.title ? "text-white" : "text-dimWhite"
                  }`}
                onClick={() => handleNavLinkClick(nav.title)}
              >
                <Link
                  to={nav.redirect}
                  className="hover:text-blue-500 transition-colors duration-300 ease-in-out"
                >
                  {nav.title}
                </Link>
              </li>
            ))}

            <li>
              <button
                onClick={() => setIsScannerOpen(true)}
                className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-black px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 shadow-md transition-colors"
              >
                Scan QR 📷
              </button>
            </li>
          </>
        )}

        {/* Auth Buttons or User Dropdown */}
        {!isLoggedIn ? (
          <>
            <li>
              <Link
                to="/login"
                className="text-white border border-zinc-500 px-4 py-2 rounded-md font-medium focus:outline-none"
              >
                Login
              </Link>
            </li>
            <li>
              <Link
                to="/register"
                className="text-white border border-zinc-500 px-4 py-2 rounded-md font-medium focus:outline-none"
              >
                Register
              </Link>
            </li>
          </>
        ) : (
          <li className="relative" ref={dropdownRef}>
            <div
              className="flex items-center space-x-2 cursor-pointer"
              onClick={toggleDropdown}
            >
              <FaUserCircle className="text-white text-3xl" />
              <div className="flex flex-col items-start mr-2">
                <span className="text-white font-bold text-sm leading-tight">
                  {userData.username || userData.email?.split('@')[0] || "User"}
                </span>
                <span className="text-zinc-500 text-[10px] truncate max-w-[120px]">
                  {userData.email || ""}
                </span>
              </div>
            </div>

            {isDropdownOpen && (
              <div className="absolute top-full right-0 mt-3 w-36 bg-zinc-800/90 backdrop-blur-md border border-zinc-700 rounded-xl shadow-2xl overflow-hidden z-50">
                <button
                  onClick={handleLogout}
                  className="block w-full text-center px-4 py-3 text-red-400 font-semibold hover:bg-zinc-700/50 hover:text-red-300 transition-colors"
                >
                  Logout
                </button>
              </div>
            )}
          </li>
        )}
      </ul>

      {/* Mobile Nav */}
      <div className="sm:hidden flex flex-1 justify-end items-center">
        <img
          src={toggle ? close : menu}
          alt="menu"
          className="w-[28px] h-[28px] object-contain"
          onClick={() => setToggle(!toggle)}
        />

        <div
          className={`${!toggle ? "hidden" : "flex"
            } p-6 bg-black-gradient absolute top-20 right-0 mx-4 my-2 min-w-[140px] rounded-xl sidebar z-50`}
        >
          <ul className="list-none flex justify-end items-start flex-1 flex-col">
            {isLoggedIn && navLinks.map((nav) => (
              <li
                key={nav.id}
                className={`font-poppins font-medium cursor-pointer text-[16px] mb-2 ${
                  active === nav.title ? "text-white" : "text-dimWhite"
                }`}
                onClick={() => {
                  handleNavLinkClick(nav.title);
                  setToggle(false);
                }}
              >
                <Link
                  to={nav.redirect}
                  className="hover:text-blue-500 transition-colors duration-300 ease-in-out"
                >
                  {nav.title}
                </Link>
              </li>
            ))}

            {!isLoggedIn ? (
              <>
                <li className="mb-2">
                  <Link
                    to="/login"
                    className="text-white border border-zinc-500 px-4 py-2 rounded-md font-medium"
                  >
                    Login
                  </Link>
                </li>
                <li>
                  <Link
                    to="/register"
                    className="text-white border border-zinc-500 px-4 py-2 rounded-md font-medium"
                  >
                    Register
                  </Link>
                </li>
              </>
            ) : (
              <>
                <li className="mb-2 text-white">{userData.username}</li>
                <li className="mb-2">
                  <Link to="/profile" className="text-white hover:text-blue-400">
                    Profile
                  </Link>
                </li>
                <li className="mb-2">
                  <Link to="/overview" className="text-white hover:text-blue-400">
                    Overview
                  </Link>
                </li>

                <li>
                  <button
                    onClick={handleLogout}
                    className="text-red-400 hover:text-red-600"
                  >
                    Logout
                  </button>
                </li>
              </>
            )}
          </ul>
        </div>
      </div>

      {/* Camera Live Scanner Modal */}
      <QRScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScanSuccess={(decodedData) => setScannedQRData(decodedData)}
      />

      {/* Payment Execution Confirmation Modal */}
      <QRPaymentModal
        isOpen={Boolean(scannedQRData)}
        onClose={() => setScannedQRData(null)}
        qrData={scannedQRData}
        user={userData}
      />
    </nav>
  );
};

export default Navbar;
