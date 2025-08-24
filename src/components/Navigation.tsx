import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ConnectKitButton } from "connectkit";
import { getAssetUrl } from "../utils/routing";

// Navigation component
const Navigation = () => {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    console.log("🔍 Navigation Debug:");
    console.log("- Setting isClient to true");
    setIsClient(true);
  }, []);
  
  console.log("- isClient:", isClient);
  console.log("- ConnectKitButton will render:", isClient);

  return (
    <nav className="navbar bg-gray-200 w-full fixed top-0 p-4 flex justify-center items-center z-50">
      <div className="flex justify-center w-[50%]">
        <span>
          <img src={getAssetUrl("/icons/icon-48x48.png")} alt="QIP Logo" />
        </span>
        <span className="mt-2">
          <Link to="/" className="ml-2 text-xl font-bold">
            Proposals
          </Link>
        </span>
      </div>
      {isClient && <ConnectKitButton />}
      <div className="flex justify-center w-[50%]">
        <Link to="/all-proposals" className="text-skin-link cursor-pointer">
          All Proposals
        </Link>
      </div>
    </nav>
  );
};

export default Navigation;
