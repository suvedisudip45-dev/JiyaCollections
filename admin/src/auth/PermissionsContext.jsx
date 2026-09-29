/* eslint-disable react/prop-types, react-refresh/only-export-components */
import { createContext, useContext } from "react";

const PermissionsContext = createContext({
  account: null,
  can: () => false,
  canAny: () => false,
});

export const PermissionsProvider = ({ account, permissions = [], children }) => {
  const permissionSet = new Set(permissions);
  const can = (permission) => permissionSet.has("all:function") || permissionSet.has(permission);
  const canAny = (requiredPermissions) => requiredPermissions.some(can);

  return (
    <PermissionsContext.Provider value={{ account, can, canAny }}>
      {children}
    </PermissionsContext.Provider>
  );
};

export const usePermissions = () => useContext(PermissionsContext);