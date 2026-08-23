import { permanentRedirect } from "next/navigation";

/**
 * `/m/mais` virou `/m/menu`.
 *
 * A rota antiga sobrevive como redirect porque ela saiu de casa: está em
 * atalho de PWA já instalado, em aba aberta e em link colado no WhatsApp da
 * equipe. `permanentRedirect` para o navegador aprender de uma vez.
 */
export default function MaisRedirect(): never {
  permanentRedirect("/m/menu");
}
