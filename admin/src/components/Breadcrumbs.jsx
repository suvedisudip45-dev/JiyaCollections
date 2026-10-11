import { ChevronRight } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

const LABELS = {
  orders: "Orders",
  "stock-transfers": "Stock Transfers",
  manufacturers: "Manufacturers",
  "order-assignments": "Order Assignments",
  "delivery-monitor": "Delivery Monitor",
  "manufacturer-inventory": "Manufacturer Inventory",
  "manufacturer-production": "Manufacturer Production",
  "distributor-applications": "Distributor Applications",
  customers: "Customers",
  inventory: "Inventory",
  finance: "Finance",
  treasury: "Treasury",
  returns: "Returns",
  payables: "Payables",
  "create-order": "Create Order",
  "add-order": "Create Order",
  "access-control": "Access Control",
  users: "Users",
  roles: "Roles",
  permissions: "Permissions",
};

const Breadcrumbs = () => {
  const { pathname } = useLocation();
  const segments = pathname.split("/").filter(Boolean);
  const crumbs = [{ label: "Home", to: "/" }];
  let path = "";

  segments.forEach((segment, index) => {
    path += `/${segment}`;
    const label = LABELS[segment] || (index === segments.length - 1 ? "Details" : segment.replaceAll("-", " "));
    crumbs.push({ label, to: path });
  });

  return (
    <nav aria-label="Breadcrumb" className="mb-5 flex flex-wrap items-center gap-1.5 text-xs capitalize text-slate-500">
      {crumbs.map((crumb, index) => (
        <span key={crumb.to} className="inline-flex items-center gap-1.5">
          {index > 0 && <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 text-slate-300" />}
          {index === crumbs.length - 1 ? (
            <span aria-current="page" className="font-semibold text-slate-800">{crumb.label}</span>
          ) : (
            <Link to={crumb.to} className="hover:text-slate-900 hover:underline">{crumb.label}</Link>
          )}
        </span>
      ))}
    </nav>
  );
};

export default Breadcrumbs;
