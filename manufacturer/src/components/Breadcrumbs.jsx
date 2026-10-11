import { ChevronRight } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useManufacturer } from "../context/ManufacturerContext";

const LABELS = {
  production: "Production",
  "bulk-transfers": "Distributor Demands",
  performance: "Performance",
  finance: "Finance",
  "pickup-profile": "Pickup Profile",
  distributor: "Distributor Overview",
  orders: "Customer Orders",
  "direct-orders": "Direct Orders",
  inventory: "Inventory",
  deliveries: "Self Delivery",
  demand: "Stock Demand & Receipts",
  "distributor/demand": "Stock Demand & Receipts",
  "distributor/finance": "Distributor Finance",
  "customer-loyalty": "Customer Loyalty",
  "gift-inventory": "Gift Inventory",
  "marketing-cards": "Marketing Cards",
};

const Breadcrumbs = () => {
  const { pathname } = useLocation();
  const { activeWorkspace } = useManufacturer();
  const segments = pathname.split("/").filter(Boolean);
  const root = activeWorkspace === "DISTRIBUTOR" ? "/distributor" : "/";
  const isDistributorHome = activeWorkspace === "DISTRIBUTOR" && segments.length === 1 && segments[0] === "distributor";
  const crumbs = [{
    label: isDistributorHome ? "Distributor Overview" : activeWorkspace === "DISTRIBUTOR" ? "Distributor Home" : "Manufacturer Home",
    to: root,
  }];
  let path = "";

  segments.forEach((segment, index) => {
    if (activeWorkspace === "DISTRIBUTOR" && index === 0 && segment === "distributor") return;
    path += `/${segment}`;
    const joined = segments.slice(0, index + 1).join("/");
    const label = LABELS[joined] || LABELS[segment] ||
      (index === segments.length - 1 ? "Details" : segment.replaceAll("-", " "));
    crumbs.push({ label, to: path });
  });

  return (
    <nav aria-label="Breadcrumb" className="mb-5 flex flex-wrap items-center gap-1.5 text-xs capitalize text-[#575757]">
      {crumbs.map((crumb, index) => (
        <span key={crumb.to} className="inline-flex items-center gap-1.5">
          {index > 0 && <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 text-[#aaa69e]" />}
          {index === crumbs.length - 1 ? (
            <span aria-current="page" className="font-semibold text-[#171717]">{crumb.label}</span>
          ) : (
            <Link to={crumb.to} className="hover:text-[#171717] hover:underline">{crumb.label}</Link>
          )}
        </span>
      ))}
    </nav>
  );
};

export default Breadcrumbs;
