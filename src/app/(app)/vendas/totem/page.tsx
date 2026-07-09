import { redirect } from "next/navigation";

// O totem virou quiosque em /totem (fora do shell). Redirect preserva bookmarks.
export default function TotemAntigoPage() {
  redirect("/totem");
}
