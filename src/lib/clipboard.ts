/**
 * Copiar texto sem depender de `navigator.clipboard`.
 *
 * A API assíncrona de clipboard só existe em **contexto seguro** (HTTPS ou
 * localhost). No desenvolvimento por subdomínio (`loja.lvh.me:3000`, HTTP) e em
 * qualquer acesso por IP na rede da loja, `navigator.clipboard` vem
 * `undefined` — e o botão morria com "Cannot read properties of undefined
 * (reading 'writeText')".
 *
 * Aqui a ordem é: usa a API moderna quando ela existe e funciona; senão cai no
 * `execCommand("copy")` sobre um textarea fora da tela, que é obsoleto mas
 * funciona em HTTP e em todos os navegadores que a loja usa.
 *
 * Devolve `false` quando nenhum caminho deu certo — quem chama avisa a pessoa
 * em vez de fingir que copiou.
 */
export async function copiarTexto(texto: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch {
      // Permissão negada ou documento sem foco: continua para o plano B.
    }
  }

  if (typeof document === "undefined") return false;

  try {
    const area = document.createElement("textarea");
    area.value = texto;
    // Fora da vista, mas ainda selecionável — `display:none` não copia.
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-9999px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, texto.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
