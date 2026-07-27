// Adapter TEF SiTef (Software Express / CliSiTef) — Electron main.
//
// ⚠️ SCAFFOLD. Implementa o MESMO contrato do tef-simulado.js (pagar/confirmar/
// desfazer/cancelar), mas dirige a DLL CliSiTef via FFI. Para RODAR de verdade
// precisa: (1) a DLL CliSiTef.dll na máquina, (2) contrato/homologação Software
// Express, (3) um servidor SiTef acessível (loja ou datacenter do adquirente).
// Sem isso, use TEF_PROVIDER=simulado.
//
// CliSiTef é INTERATIVO e stateful: Inicializa → IniciaFuncao → laço de
// ContinuaFuncao (o pinpad e a DLL conduzem a coleta de cartão/senha; o PDV só
// responde a mensagens/confirmações) → FinalizaFuncao (confirma OU desfaz). É
// esse "Finaliza" que dá o DOIS-FASES que o contrato TefProvider exige.
//
// Referências (manual CliSiTef da Software Express):
//   - ConfiguraIntSiTefInterativoEx(ip, loja, terminal, reservado)
//   - IniciaFuncaoSiTefInterativo(modalidade, valor, cupom, data, hora, operador, restricoes)
//   - ContinuaFuncaoSiTefInterativo(&comando, &tipoCampo, &min, &max, buffer, tamBuffer, continua)
//   - FinalizaTransacaoSiTefInterativo(confirma /*1=confirma, 0=desfaz*/, cupom, data, hora)
//   - Códigos de campo da transação (NSU/autorização/bandeira) vêm no laço via
//     comandos de "coleta de informação" — VER O MANUAL e preencher os TODO.

let koffi;
try {
  // Instale com: npm i koffi   (FFI nativo, com prebuilds; funciona no Electron)
  koffi = require("koffi");
} catch {
  koffi = null;
}

// ── Config (variáveis de ambiente do app desktop) ──
const CFG = {
  dllPath: process.env.SITEF_DLL_PATH || "CliSiTef.dll",
  ip: process.env.SITEF_IP || "127.0.0.1", // servidor SiTef
  loja: process.env.SITEF_LOJA || "00000000",
  terminal: process.env.SITEF_TERMINAL || "SP000001",
  operador: process.env.SITEF_OPERADOR || "NOHUB",
};

// Modalidade da IniciaFuncao. 0 = pagamento genérico (o pinpad decide a forma).
// Crédito/débito têm códigos próprios no manual — mapear ao confirmar o contrato.
const MODALIDADE = { GENERICO: 0, CREDITO: 3, DEBITO: 2 };

// tipo de retorno das funções: todas devolvem int (0 = ok; 10000 = continua o
// laço; < 0 = erro; ver manual para os >0).
function carregarDll() {
  if (!koffi) throw new Error("koffi não instalado — rode `npm i koffi`.");
  const lib = koffi.load(CFG.dllPath);
  return {
    ConfiguraIntSiTefInterativoEx: lib.func(
      "int ConfiguraIntSiTefInterativoEx(const char* ip, const char* loja, const char* terminal, const char* reservado)",
    ),
    IniciaFuncaoSiTefInterativo: lib.func(
      "int IniciaFuncaoSiTefInterativo(int modalidade, const char* valor, const char* cupom, const char* data, const char* hora, const char* operador, const char* restricoes)",
    ),
    // buffer é out; koffi usa _Out_ para ponteiros de saída.
    ContinuaFuncaoSiTefInterativo: lib.func(
      "int ContinuaFuncaoSiTefInterativo(_Out_ int* comando, _Out_ int* tipoCampo, _Out_ int* min, _Out_ int* max, _Out_ char* buffer, int tamBuffer, int continua)",
    ),
    FinalizaTransacaoSiTefInterativo: lib.func(
      "int FinalizaTransacaoSiTefInterativo(int confirma, const char* cupom, const char* data, const char* hora)",
    ),
  };
}

const dataAAAAMMDD = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
};
const horaHHMMSS = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

function tefSitef() {
  let dll = null;
  let configurado = false;

  function garantirConfig() {
    if (!dll) dll = carregarDll();
    if (!configurado) {
      const r = dll.ConfiguraIntSiTefInterativoEx(CFG.ip, CFG.loja, CFG.terminal, "");
      if (r !== 0) throw new Error(`SiTef: falha ao configurar (código ${r}).`);
      configurado = true;
    }
  }

  // Laço interativo. Coleta os dados da transação enquanto a DLL/pinpad conduzem.
  // Retorna o resultado normalizado (TefResultado).
  function executarLaco({ cupom }) {
    const resultado = {
      status: "ERRO",
      bandeira: null,
      parcelas: null,
      nsu: null,
      autorizacao: null,
      adquirente: "SITEF",
      adquirenteCnpj: null,
      comprovanteCliente: null,
      comprovanteLoja: null,
      // tefId do SiTef = (cupom + data + hora + NSU) — chave do desfazimento.
      tefId: null,
    };

    const comando = [0];
    const tipoCampo = [0];
    const min = [0];
    const max = [0];
    const TAM = 20000;
    const buffer = Buffer.alloc(TAM);
    let continua = 0;

    // 10000 = precisa continuar; 0 = terminou com sucesso; !=0/!=10000 = fim.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const ret = dll.ContinuaFuncaoSiTefInterativo(
        comando,
        tipoCampo,
        min,
        max,
        buffer,
        TAM,
        continua,
      );

      if (ret === 0) {
        resultado.status = "APROVADO";
        break;
      }
      if (ret !== 10000) {
        // <0 = erro; alguns >0 = cancelado pelo operador/cliente
        resultado.status = ret === -1 ? "CANCELADO" : "RECUSADO";
        resultado.mensagem = `SiTef retornou ${ret}.`;
        break;
      }

      const cmd = comando[0];
      const texto = buffer.toString("latin1").split("\0")[0];

      // TODO(manual CliSiTef): tratar cada comando. Os principais:
      //  - 0/1/2/3 exibir mensagens (permanente/transitória/cliente/loja)
      //  - 21/22/23... coleta de informação (NSU, autorização, bandeira, vias)
      //  - menus e campos: em geral o pinpad resolve; quando pede confirmação
      //    do operador (SIM/NÃO), responder via `continua` (1=sim/prossegue).
      // Aqui capturamos as vias e deixamos placeholders para os campos-chave.
      switch (cmd) {
        case 34: // via cliente (exemplo — CONFERIR o código no manual)
          resultado.comprovanteCliente = texto;
          break;
        case 35: // via loja (exemplo — CONFERIR)
          resultado.comprovanteLoja = texto;
          break;
        // TODO: NSU → resultado.nsu; autorização → resultado.autorizacao;
        //       bandeira → normalizar; parcelas; montar tefId.
        default:
          break;
      }

      continua = 1; // prossegue o fluxo (resposta padrão "OK/continuar")
    }

    resultado.tefId =
      resultado.tefId || `sitef_${cupom}_${dataAAAAMMDD()}_${horaHHMMSS()}`;
    return resultado;
  }

  return {
    slug: "SITEF",

    async pagar(input) {
      garantirConfig();
      const cupom = (input.referencia || "0").replace(/\D/g, "").slice(-9) || "1";
      const modalidade =
        input.tipo === "CREDITO"
          ? MODALIDADE.CREDITO
          : input.tipo === "DEBITO"
            ? MODALIDADE.DEBITO
            : MODALIDADE.GENERICO;
      // Valor em centavos como string (formato do CliSiTef: sem separador).
      const valor = String(Math.round(Number(input.valor) * 100));
      const ini = dll.IniciaFuncaoSiTefInterativo(
        modalidade,
        valor,
        cupom,
        dataAAAAMMDD(),
        horaHHMMSS(),
        CFG.operador,
        // restrições (parcelamento etc.) — string do manual; TODO conforme regra.
        input.parcelas && input.parcelas > 1 ? `[parcelas=${input.parcelas}]` : "",
      );
      if (ini !== 0) {
        return { status: "ERRO", mensagem: `SiTef: IniciaFuncao retornou ${ini}.`, bandeira: null, parcelas: null, nsu: null, autorizacao: null, adquirente: "SITEF", adquirenteCnpj: null, comprovanteCliente: null, comprovanteLoja: null, tefId: null };
      }
      const r = executarLaco({ cupom });
      r.parcelas = r.parcelas ?? (input.tipo === "CREDITO" ? input.parcelas ?? 1 : 1);
      // guarda o cupom no tefId para o Finaliza (confirmar/desfazer) casar.
      r._cupom = cupom;
      return r;
    },

    async confirmar(input) {
      // 2ª fase: confirma a transação pendente (1 = confirma).
      garantirConfig();
      const cupom = (input.tefId || "").split("_")[1] || "1";
      dll.FinalizaTransacaoSiTefInterativo(1, cupom, dataAAAAMMDD(), horaHHMMSS());
    },

    async desfazer(input) {
      // Rollback: desfaz a transação pendente (0 = desfaz).
      garantirConfig();
      const cupom = (input.tefId || "").split("_")[1] || "1";
      dll.FinalizaTransacaoSiTefInterativo(0, cupom, dataAAAAMMDD(), horaHHMMSS());
    },

    async cancelar(input) {
      // Cancelamento de transação já confirmada = função própria do CliSiTef
      // (modalidade de cancelamento administrativo). TODO: mapear a modalidade
      // de cancelamento e rodar o mesmo laço interativo.
      garantirConfig();
      return {
        status: "ERRO",
        mensagem: "Cancelamento SiTef ainda não implementado (ver TODO).",
        bandeira: null, parcelas: null, nsu: null, autorizacao: null,
        adquirente: "SITEF", adquirenteCnpj: null,
        comprovanteCliente: null, comprovanteLoja: null,
        tefId: input.tefId,
      };
    },

    async resolverPendencias() {
      // Na abertura do caixa: confirma/desfaz transações que ficaram em aberto
      // (queda no meio). CliSiTef tem função de "pendências" — TODO ao integrar.
    },
  };
}

module.exports = { tefSitef };
