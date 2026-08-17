// ============================================================
// Gera um XML de NF-e de teste a partir da DANFE 183095/39 da CRBS (Ambev).
//
// Para que serve: a DANFE impressa não tem qTrib nem FCP-ST por item — só o
// XML tem. Sem um XML não dá para exercitar a conversão caixa→unidade nem a
// composição de custo. Esta nota é o caso difícil de verdade: distribuidor que
// vende em caixa, tributa em unidade, cobra ICMS-ST e FECOP, e manda "SEM GTIN"
// em tudo (então todo item cai no de-para manual).
//
// O arquivo gerado NÃO é uma nota fiscal: não tem assinatura digital nem
// protocolo de autorização. É fixture de desenvolvimento e só passa no nosso
// importador, que aceita `NFe` sem protocolo.
//
// Uso:
//   node scripts/fixture-nfe.mjs [--cnpj-dest=45131944000136] [--saida=tmp/…xml]
//
// O CNPJ do destinatário PRECISA bater com o FiscalEmitente da loja ativa,
// senão `importarNotasXml` recusa com "Nota emitida para o CNPJ … que não é o
// desta loja." — passe --cnpj-dest com o CNPJ da sua loja de teste.
// ============================================================

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const CHAVE = "43260856228356007900550390001830951157156333";

/**
 * Itens transcritos da DANFE, coluna a coluna.
 *   u/q/vu  = uCom, qCom, vUnCom (como o fornecedor vende)
 *   ut/qt   = uTrib, qTrib      (como o fornecedor tributa → nosso fator)
 *   fcpst   = FECOP ST impresso na observação do item
 * Conferência: a soma de `vProd` dá 2.961,57 e a de `ipi` dá 50,84, iguais aos
 * totais da nota. Se alguém mexer nesta tabela, é isso que tem de continuar
 * fechando.
 */
const ITENS = [
  // cProd, xProd, NCM, CST, CFOP, uCom, qCom, vUnCom, uTrib, qTrib, vUnTrib, vProd, vBC, vICMS, vIPI, pICMS, pIPI, vFCPST
  ["32648", "BUBBALOO MORANGO DISPLAY 5G CX/60", "17041000", "51", "5102", "cx06", 1, 13.8962, "cx", 1, 13.90, 13.90, 14.12, 1.69, 0, 17, 0, 0],
  ["30045", "RED BULL BR LATA 473ML CX C 12", "22029900", "10", "5403", "cx", 1, 135.5874, "un", 12, 11.2992, 135.59, 138.07, 34.52, 0, 25, 0, 0],
  ["21666", "RED BULL TROPICAL BR LATA 250ML FOUR PACK NPAL", "22029900", "10", "5403", "cx", 1, 27.5317, "un", 4, 6.8825, 27.53, 28.04, 7.01, 0, 25, 0, 0],
  ["21968", "TRIDENT HORTELA ENVELOPE 8G CX C/21", "21069050", "51", "5102", "cx02", 2, 36.9008, "cx", 2, 36.90, 73.80, 74.99, 9.00, 0, 17, 0, 0],
  ["21973", "TRIDENT MELANCIA ENVELOPE 8G CX C/21", "21069050", "51", "5102", "cx02", 2, 36.9008, "cx", 2, 36.90, 73.80, 74.99, 9.00, 0, 17, 0, 0],
  ["32969", "RED BULL SUMMER MORANGO E PESSEGO LATA 250ML FOUR PACK NPAL", "22029900", "10", "5403", "cx", 1, 25.9244, "un", 4, 6.48, 25.92, 26.41, 6.60, 0, 25, 0, 0],
  ["21970", "TRIDENT MENTA ENVELOPE 8G CX C/21", "21069050", "51", "5102", "cx02", 2, 36.9008, "cx", 2, 36.90, 73.80, 74.99, 9.00, 0, 17, 0, 0],
  ["18836", "CORONA EXTRA N LONG NECK 330ML CX C/24 NPAL", "22030000", "10", "5403", "cx", 5, 134.8771, "un", 120, 5.6199, 674.39, 686.93, 171.73, 20.06, 25, 2.92, 18.98],
  ["24306", "RED BULL MELANCIA LATA 250ML FOUR PACK NPAL", "22029900", "10", "5403", "cx", 3, 26.9926, "un", 12, 6.7483, 80.98, 82.49, 20.62, 0, 25, 0, 0],
  ["7982", "GATORADE LIMAO PET 500ML SIXPACK", "22029900", "10", "5403", "cx", 1, 22.2902, "un", 6, 3.715, 22.29, 22.71, 5.68, 0.44, 25, 1.95, 0],
  ["7977", "GATORADE UVA PET 500ML SIXPACK", "22029900", "10", "5403", "cx", 1, 21.2761, "un", 6, 3.5467, 21.28, 21.68, 5.42, 0.42, 25, 1.95, 0],
  ["7981", "GATORADE LARANJA PET 500ML SIXPACK", "22029900", "10", "5403", "cx", 2, 22.2852, "un", 12, 3.7142, 44.57, 45.42, 11.35, 0.89, 25, 1.95, 0],
  ["27179", "HALLS MORANGO ENVELOPE 28G CX C/21", "17049020", "51", "5102", "cx02", 1, 25.893, "cx", 1, 25.89, 25.89, 26.31, 3.15, 0, 17, 0, 0],
  ["25837", "SPATEN N LT 473ML CX CARTAO C/12", "22030000", "10", "5403", "cx", 2, 50.635, "un", 24, 4.2196, 101.27, 103.20, 25.80, 3.01, 25, 2.92, 3.06],
  ["22326", "BRAHMA DUPLO MALTE LT 473ML SH C/12 NPAL", "22030000", "10", "5403", "cx", 1, 48.3141, "un", 12, 4.0258, 48.31, 49.22, 12.30, 1.44, 25, 2.92, 1.38],
  ["27866", "CORONA CERO SUNBREW N LONG NECK 330 ML SP BASKET CX C4", "22029100", "10", "5403", "cx", 1, 135.4618, "un", 24, 5.6442, 135.46, 137.97, 34.49, 4.03, 25, 2.92, 3.76],
  ["32646", "BUBBALOO TUTTI FRUTTI DISPLAY 5G CX/60", "17041000", "51", "5102", "cx06", 1, 13.8962, "cx", 1, 13.90, 13.90, 14.12, 1.69, 0, 17, 0, 0],
  ["21974", "TRIDENT TUTTI-FRUTTI ENVELOPE 8G CX C/21", "21069050", "51", "5102", "cx02", 1, 36.8958, "cx", 1, 36.90, 36.90, 37.49, 4.50, 0, 17, 0, 0],
  ["22007", "HALLS EXTRA FORTE ENVELOPE 28G CX C/21", "17049020", "51", "5102", "cx02", 1, 25.893, "cx", 1, 25.89, 25.89, 26.31, 3.15, 0, 17, 0, 0],
  ["7983", "GATORADE MORANGO-MARACUJA PET 500ML SIXPACK", "22029900", "10", "5403", "cx", 1, 21.2761, "un", 6, 3.5467, 21.28, 21.68, 5.42, 0.42, 25, 1.95, 0],
  ["32644", "BUBBALOO UVA DISPLAY 5G CX/60", "17041000", "51", "5102", "cx06", 1, 13.8962, "cx", 1, 13.90, 13.90, 14.12, 1.69, 0, 17, 0, 0],
  ["22005", "HALLS MENTA ENVELOPE 28G CX C/21", "17049020", "51", "5102", "cx02", 1, 25.893, "cx", 1, 25.89, 25.89, 26.31, 3.15, 0, 17, 0, 0],
  ["18152", "GUARANA CHP ANTARCTICA PET 200ML SH C/12", "22021000", "10", "5403", "cx", 1, 18.0351, "un", 12, 1.5033, 18.04, 18.36, 3.31, 0.18, 18, 0.98, 0],
  ["5029", "PEPSI TWIST PET 2L SHRINK C/8", "22021000", "10", "5403", "cx", 4, 53.0414, "un", 32, 6.6303, 212.17, 215.92, 38.87, 3.15, 18, 1.46, 0],
  ["9277", "PEPSI ZERO PET 2L SHRINK C/8", "22021000", "10", "5403", "cx", 6, 52.4871, "un", 48, 6.5608, 314.92, 320.55, 57.70, 6.25, 18, 1.95, 0],
  ["13065", "H2OH LIMONETO PET 1,5 SHRINK C/06 NPAL", "22021000", "10", "5403", "cx", 1, 35.7485, "un", 6, 5.9583, 35.75, 36.38, 6.55, 0.53, 18, 1.46, 0],
  ["18137", "GUARANA CHP ANTARCTICA PET 3L C/04 SHRINK LISO", "22021000", "10", "5403", "cx", 2, 34.5666, "un", 8, 8.6412, 69.13, 70.32, 12.66, 0.69, 18, 0.98, 0],
  ["2937", "GUARANA CHP ANTARCTICA PET 2L SHRINK C/8", "22021000", "10", "5403", "cx", 2, 50.328, "un", 16, 6.2912, 100.66, 102.45, 18.44, 1.00, 18, 0.98, 0],
  ["8793", "H2OH LIMAO C/GAS PET 1,5L CAIXA C/6", "22021000", "10", "5403", "cx", 1, 35.7485, "un", 6, 5.9583, 35.75, 36.38, 6.55, 0.53, 18, 1.46, 0],
  ["9084", "GUARANA CHP ANTARCTICA LATA 350ML SH C/12 NPAL", "22021000", "10", "5403", "cx", 1, 30.9499, "un", 12, 2.5792, 30.95, 31.51, 5.67, 0.31, 18, 0.98, 0],
  ["18341", "PEPSI COLA PET 3000 ML C/04 SHRINK LISO", "22021000", "10", "5403", "cx", 10, 32.7002, "un", 40, 8.175, 327.00, 332.70, 59.89, 6.49, 18, 1.95, 0],
  ["2938", "GUARANA CHP ANTARCTICA DIET PET 2L SHRINK C/8", "22021000", "10", "5403", "cx", 2, 50.328, "un", 16, 6.2912, 100.66, 102.45, 18.44, 1.00, 18, 0.98, 0],
];

const CAMPOS = [
  "cProd", "xProd", "ncm", "cst", "cfop", "uCom", "qCom", "vUnCom",
  "uTrib", "qTrib", "vUnTrib", "vProd", "vBC", "vICMS", "vIPI", "pICMS", "pIPI", "vFCPST",
];
const itens = ITENS.map((linha) => Object.fromEntries(CAMPOS.map((c, i) => [c, linha[i]])));

const TOTAL_ICMS_ST = 251.68; // a DANFE só imprime o total; rateamos por vProd
const TOTAL_OUTRAS = 53.0; // "outras despesas" — idem, só no total da nota
const TOTAL_NOTA = 3344.27;

const cents = (n) => Math.round(n * 100);
const dec = (n, casas = 2) => n.toFixed(casas);

/**
 * ICMS-ST por item, rateado sobre os itens que têm ST (CST 10). Os CST 51
 * (diferimento — as balas e chicletes) ficam de fora. A sobra de arredondamento
 * vai no maior item, para a soma bater no centavo com a nota.
 */
function ratearIcmsSt() {
  const comSt = itens.filter((i) => i.cst === "10");
  const base = comSt.reduce((s, i) => s + i.vProd, 0);
  let acumulado = 0;
  for (const item of comSt) {
    item.vICMSST = Math.round((TOTAL_ICMS_ST * item.vProd) / base * 100) / 100;
    acumulado += item.vICMSST;
  }
  const sobra = (cents(TOTAL_ICMS_ST) - cents(acumulado)) / 100;
  if (sobra !== 0) {
    const maior = comSt.reduce((a, b) => (b.vProd > a.vProd ? b : a));
    maior.vICMSST = Math.round((maior.vICMSST + sobra) * 100) / 100;
  }
  for (const item of itens) item.vICMSST ??= 0;
}

/** Confere a transcrição contra os totais impressos na DANFE. */
function conferir() {
  const soma = (campo) => itens.reduce((s, i) => s + i[campo], 0);
  const checagens = [
    ["produtos", soma("vProd"), 2961.57],
    ["IPI", soma("vIPI"), 50.84],
    ["FECOP ST", soma("vFCPST"), 27.18],
    ["ICMS ST", soma("vICMSST"), TOTAL_ICMS_ST],
  ];
  const erros = checagens.filter(([, a, b]) => cents(a) !== cents(b));
  for (const [nome, a, b] of checagens) {
    console.log(`  ${cents(a) === cents(b) ? "ok " : "ERRO"} ${nome}: ${dec(a)} (nota: ${dec(b)})`);
  }
  if (erros.length) {
    throw new Error("A transcrição não fecha com os totais da DANFE — corrija a tabela ITENS.");
  }
  const total = soma("vProd") + soma("vICMSST") + soma("vFCPST") + soma("vIPI") + TOTAL_OUTRAS;
  console.log(`  ${cents(total) === cents(TOTAL_NOTA) ? "ok " : "ERRO"} total da nota: ${dec(total)}`);
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Grupo de ICMS conforme o CST: 10 = com ST cobrada; 51 = diferimento. */
function grupoIcms(i) {
  if (i.cst === "51") {
    return `<ICMS51><orig>0</orig><CST>51</CST><vBC>${dec(i.vBC)}</vBC><pICMS>${dec(i.pICMS)}</pICMS><vICMS>${dec(i.vICMS)}</vICMS></ICMS51>`;
  }
  const bcSt = i.vBC + i.vICMSST * 2; // aproximação: a DANFE não imprime BC ST por item
  return (
    `<ICMS10><orig>0</orig><CST>10</CST>` +
    `<modBC>3</modBC><vBC>${dec(i.vBC)}</vBC><pICMS>${dec(i.pICMS)}</pICMS><vICMS>${dec(i.vICMS)}</vICMS>` +
    `<modBCST>4</modBCST><vBCST>${dec(bcSt)}</vBCST><pICMSST>${dec(i.pICMS)}</pICMSST><vICMSST>${dec(i.vICMSST)}</vICMSST>` +
    (i.vFCPST ? `<pFCPST>2.00</pFCPST><vFCPST>${dec(i.vFCPST)}</vFCPST>` : "") +
    `</ICMS10>`
  );
}

function det(i, n) {
  const ipi = i.vIPI
    ? `<IPI><cEnq>999</cEnq><IPITrib><CST>50</CST><vBC>${dec(i.vProd)}</vBC><pIPI>${dec(i.pIPI)}</pIPI><vIPI>${dec(i.vIPI)}</vIPI></IPITrib></IPI>`
    : `<IPI><cEnq>999</cEnq><IPINT><CST>53</CST></IPINT></IPI>`;
  return (
    `<det nItem="${n}">` +
    `<prod>` +
    `<cProd>${esc(i.cProd)}</cProd><cEAN>SEM GTIN</cEAN><xProd>${esc(i.xProd)}</xProd>` +
    `<NCM>${i.ncm}</NCM><CFOP>${i.cfop}</CFOP>` +
    `<uCom>${i.uCom}</uCom><qCom>${dec(i.qCom, 4)}</qCom><vUnCom>${dec(i.vUnCom, 4)}</vUnCom>` +
    `<vProd>${dec(i.vProd)}</vProd>` +
    `<cEANTrib>SEM GTIN</cEANTrib>` +
    `<uTrib>${i.uTrib}</uTrib><qTrib>${dec(i.qTrib, 4)}</qTrib><vUnTrib>${dec(i.vUnTrib, 4)}</vUnTrib>` +
    `<indTot>1</indTot>` +
    `</prod>` +
    `<imposto><ICMS>${grupoIcms(i)}</ICMS>${ipi}</imposto>` +
    `</det>`
  );
}

function montarXml(cnpjDest, nomeDest) {
  const soma = (campo) => itens.reduce((s, i) => s + i[campo], 0);
  return `<?xml version="1.0" encoding="UTF-8"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe versao="4.00" Id="NFe${CHAVE}">
    <ide>
      <cUF>43</cUF><natOp>VENDA DE PRODUTOS</natOp><mod>55</mod><serie>39</serie><nNF>183095</nNF>
      <dhEmi>2026-08-12T20:10:40-03:00</dhEmi><tpNF>1</tpNF><idDest>1</idDest><tpEmis>1</tpEmis><tpAmb>2</tpAmb>
    </ide>
    <emit>
      <CNPJ>56228356007900</CNPJ>
      <xNome>CRBS S/A</xNome>
      <xFant>CDD PORTO ALEGRE</xFant>
      <enderEmit>
        <xLgr>AV INDUSTRIAL BELGRAF</xLgr><nro>765</nro><xBairro>MEDIANEIRA</xBairro>
        <cMun>4306767</cMun><xMun>ELDORADO DO SUL</xMun><UF>RS</UF><CEP>92990000</CEP>
        <fone>08008871111</fone>
      </enderEmit>
      <IE>2670028874</IE><CRT>3</CRT>
    </emit>
    <dest>
      <CNPJ>${cnpjDest}</CNPJ>
      <xNome>${esc(nomeDest)}</xNome>
      <enderDest>
        <xLgr>RUA ADELAIDE HELEGDA ROLIM DE</xLgr><nro>579</nro><xBairro>MORADA DO BOSQUE</xBairro>
        <cMun>4303103</cMun><xMun>CACHOEIRINHA</xMun><UF>RS</UF><CEP>94960844</CEP>
        <fone>5199661569</fone>
      </enderDest>
      <indIEDest>1</indIEDest><IE>1770260029</IE>
    </dest>
    ${itens.map((i, n) => det(i, n + 1)).join("\n    ")}
    <total>
      <ICMSTot>
        <vBC>3014.59</vBC><vICMS>${dec(soma("vICMS"))}</vICMS>
        <vBCST>3792.66</vBCST><vST>${dec(soma("vICMSST"))}</vST>
        <vFCPST>${dec(soma("vFCPST"))}</vFCPST>
        <vProd>${dec(soma("vProd"))}</vProd>
        <vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc>
        <vIPI>${dec(soma("vIPI"))}</vIPI>
        <vOutro>${dec(TOTAL_OUTRAS)}</vOutro>
        <vNF>${dec(TOTAL_NOTA)}</vNF>
      </ICMSTot>
    </total>
    <cobr>
      <fat><nFat>183095</nFat><vOrig>${dec(TOTAL_NOTA)}</vOrig><vLiq>${dec(TOTAL_NOTA)}</vLiq></fat>
      <dup><nDup>001</nDup><dVenc>2026-08-20</dVenc><vDup>${dec(TOTAL_NOTA)}</vDup></dup>
    </cobr>
  </infNFe>
</NFe>
`;
}

const args = process.argv.slice(2);
const arg = (nome, padrao) =>
  args.find((a) => a.startsWith(`--${nome}=`))?.split("=")[1] ?? padrao;

const cnpjDest = arg("cnpj-dest", "45131944000136").replace(/\D/g, "");
const nomeDest = arg("dest-nome", "PATRICK TAVARES");
const saida = resolve(process.cwd(), arg("saida", "tmp/nfe-183095-fixture.xml"));

ratearIcmsSt();
console.log("Conferindo a transcrição contra a DANFE:");
conferir();

mkdirSync(dirname(saida), { recursive: true });
writeFileSync(saida, montarXml(cnpjDest, nomeDest), "utf8");

console.log(`\n${itens.length} itens · destinatário ${cnpjDest}`);
console.log(`Arquivo: ${saida}`);
