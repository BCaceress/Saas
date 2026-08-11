import { Loader2, MonitorSmartphone } from "lucide-react";

/**
 * Casca do quiosque enquanto o servidor resolve sessão, loja e catálogo.
 *
 * Sem isto o Next segura a navegação inteira nesse tempo — quem toca em "Modo
 * autoatendimento" no `/m` fica olhando a tela do Mais sem nada acontecer. Aqui
 * o esqueleto não imita a grade de produtos de propósito: o quiosque abre na
 * tela de boas-vindas, e um esqueleto de grade seria um salto de layout.
 */
export default function TotemLoading() {
  return (
    <div
      className="grid min-h-dvh place-items-center bg-canvas px-6"
      role="status"
      aria-busy="true"
      aria-label="Abrindo o autoatendimento"
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <MonitorSmartphone className="h-10 w-10 text-brand" aria-hidden />
        <p className="font-display text-lg font-semibold text-ink">Abrindo o autoatendimento</p>
        <Loader2 className="h-5 w-5 animate-spin text-muted" aria-hidden />
      </div>
    </div>
  );
}
