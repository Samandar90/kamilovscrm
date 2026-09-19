import { useMemo } from "react";
import { useAuth } from "../auth/AuthContext";
import type { UserRole } from "../auth/types";
import {
  navigationConfig,
  type NavigationItem,
  type NavigationSection,
} from "./navigationConfig";

const filterItemByRole = (
  item: NavigationItem,
  role: UserRole
): NavigationItem | null => {
  if (!item.roles.includes(role)) {
    return null;
  }

  if (!item.children || item.children.length === 0) {
    return item;
  }

  const filteredChildren = item.children
    .map((child) => filterItemByRole(child, role))
    .filter((child): child is NavigationItem => child !== null);

  if (filteredChildren.length === 0) {
    return null;
  }

  return {
    ...item,
    children: filteredChildren,
  };
};

export const useNavigation = (): NavigationSection[] => {
  const { user } = useAuth();

  return useMemo(() => {
    if (!user) {
      return [];
    }

    return navigationConfig
      .map((section) => {
        const items = section.items
          .map((item) => filterItemByRole(item, user.role))
          .filter((item): item is NavigationItem => item !== null);

        return { ...section, items };
      })
      .filter((section) => section.items.length > 0);
  }, [user]);
};
