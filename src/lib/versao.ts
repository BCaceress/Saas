import pkg from "../../package.json";

/**
 * Versão do app, lida do `package.json` — fonte única. Aparece no rodapé de
 * "Mais" (`/m`) para que um relato de problema venha com a versão junto, sem
 * pedir para a pessoa procurar.
 */
export const VERSAO_APP: string = pkg.version;
