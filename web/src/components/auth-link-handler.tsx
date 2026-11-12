"use client";

import { useEffect } from "react";
import { handleAuthLink } from "@/lib/supabase-browser";

export function AuthLinkHandler() {
  useEffect(() => {
    void handleAuthLink();
  }, []);

  return null;
}
