type DrawerNavigation = {
  openDrawer?: () => void;
  closeDrawer?: () => void;
};

let drawerNavigation: DrawerNavigation | null = null;
let pendingOpen = false;

export function registerDrawerNavigation(navigation: DrawerNavigation) {
  drawerNavigation = navigation;
  return () => {
    if (drawerNavigation === navigation) drawerNavigation = null;
  };
}

export function requestDrawerOpen() {
  pendingOpen = true;
}

export function openDrawerDirect() {
  pendingOpen = false;
  drawerNavigation?.openDrawer?.();
}

export function consumeDrawerRequest() {
  if (!pendingOpen) return false;
  pendingOpen = false;
  return true;
}
