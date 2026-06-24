"use server";

import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { rootUrl } from "@/lib/urls";

export async function signOutAction() {
  await signOut({ redirect: false });
  redirect(rootUrl("/login"));
}
