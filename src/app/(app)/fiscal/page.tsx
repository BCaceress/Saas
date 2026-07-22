import { redirect } from "next/navigation";

/** O módulo abre na primeira aba. */
export default function FiscalPage() {
  redirect("/fiscal/notas-emitidas");
}
