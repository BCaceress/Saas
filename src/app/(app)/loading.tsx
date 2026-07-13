import { SkPageHeader, SkToolbar, SkTable } from "@/components/app/skeletons";

/**
 * Fallback genérico do shell: usado só por rotas sem `loading.tsx` próprio.
 * Aparece imediatamente ao navegar pelo menu, enquanto o servidor renderiza.
 */
export default function AppLoading() {
  return (
    <div className="flex animate-pulse flex-col gap-5" aria-busy="true" aria-label="Carregando página">
      <SkPageHeader />
      <SkToolbar pills={3} />
      <SkTable rows={6} />
    </div>
  );
}
