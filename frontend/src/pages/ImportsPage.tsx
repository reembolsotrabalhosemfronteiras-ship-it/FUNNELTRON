import { useEffect, useRef, useState } from "react";
import {
  FileCsv,
  Trash,
  Warning,
  CheckCircle,
  WarningCircle,
} from "@phosphor-icons/react";
import { Header } from "@/components/common/Header";
import { cn } from "@/lib/cn";
import {
  parseDelimited,
  guessColumnKind,
  type ColumnKind,
  type ParsedTable,
} from "@/lib/csv";
import {
  listImports,
  saveImport,
  deleteImport,
  type SalesImport,
} from "@/api/client";

const KIND_STYLE: Record<ColumnKind, string> = {
  dinheiro: "text-[var(--c-high)] border-[var(--c-high)]/40",
  número: "text-primary border-primary/40",
  data: "text-[var(--c-mid)] border-[var(--c-mid)]/40",
  texto: "text-muted-foreground border-border",
  vazia: "text-[var(--c-low)] border-[var(--c-low)]/40",
};

export function ImportsPage() {
  const [imports, setImports] = useState<SalesImport[]>([]);
  const [preview, setPreview] = useState<{ name: string; table: ParsedTable } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listImports().then(setImports);
  }, []);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);

    if (/\.xlsx?$/i.test(file.name)) {
      setError(
        "Arquivo Excel ainda não é lido — o app não tem biblioteca de planilha instalada. Exporte como CSV na UTMify."
      );
      return;
    }

    const text = await file.text();
    const table = parseDelimited(text);

    if (table.headers.length < 2) {
      setError(
        "Não consegui identificar colunas neste arquivo. Ele é mesmo um CSV separado por vírgula, ponto e vírgula ou tabulação?"
      );
      return;
    }

    setPreview({ name: file.name, table });
  };

  const confirmImport = async () => {
    if (!preview) return;
    const saved = await saveImport({
      fileName: preview.name,
      headers: preview.table.headers,
      rowCount: preview.table.rows.length,
      delimiter: preview.table.delimiter,
      sampleRows: preview.table.rows.slice(0, 20),
    });
    setImports((prev) => [saved, ...prev]);
    setPreview(null);
  };

  const remove = async (id: string) => {
    await deleteImport(id);
    setImports((prev) => prev.filter((i) => i.id !== id));
  };

  return (
    <div className="min-h-screen bg-background">
      <Header title="Importações" subtitle="Relatórios de vendas da UTMify" />

      <main className="flex flex-col gap-[18px] p-4 md:px-7 md:py-6 max-w-[900px]">
        {/* Aviso honesto sobre o estágio atual */}
        <div
          className="card"
          style={{ padding: 14, border: "1px solid var(--c-mid)", background: "hsl(38 92% 58% / 0.08)" }}
        >
          <p className="m-0 flex items-start gap-2 text-[13px]">
            <Warning size={16} className="mt-0.5 shrink-0" style={{ color: "var(--c-mid)" }} />
            O arquivo é lido e as colunas são identificadas — mas o mapeamento das colunas da UTMify
            para os campos internos (receita, taxas, gasto em anúncio, UTMs) e as regras de
            atribuição ainda estão pendentes. Importe um relatório real: os cabeçalhos que
            aparecerem são o que preciso para escrever esse mapeamento.
          </p>
        </div>

        {/* Área de upload */}
        <div className="card elev-sm !p-[18px]">
          <p className="card-title mb-0.5">Enviar relatório</p>
          <p className="card-body mb-3.5">CSV ou TSV exportado da UTMify · o separador é detectado sozinho</p>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              handleFile(e.dataTransfer.files[0]);
            }}
            onClick={() => inputRef.current?.click()}
            className={cn(
              "cursor-pointer rounded-md border-2 border-dashed p-9 text-center transition-colors",
              dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
            )}
          >
            <FileCsv size={32} className="mx-auto mb-2.5 text-neutral-500" />
            <p className="text-[13px] font-semibold">Arraste o arquivo aqui ou clique para escolher</p>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">.csv · .tsv · .txt</p>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain"
              className="hidden"
              onChange={(e) => {
                handleFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>

          {error && (
            <p
              className="mt-3 flex items-start gap-2 rounded-md p-3 text-sm"
              style={{ border: "1px solid hsl(var(--danger) / 0.3)", background: "hsl(var(--danger) / 0.08)", color: "hsl(var(--danger))" }}
            >
              <WarningCircle size={16} className="mt-px shrink-0" />
              {error}
            </p>
          )}
        </div>

        {/* Prévia do que foi lido */}
        {preview && (
          <div className="card elev-sm !p-[18px]" style={{ border: "1px solid var(--color-accent-800)" }}>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="card-title">Prévia: {preview.name}</p>
                <p className="card-body">
                  {preview.table.rows.length.toLocaleString("pt-BR")} linhas ·{" "}
                  {preview.table.headers.length} colunas · separador{" "}
                  <code className="rounded bg-neutral-900/60 px-1">
                    {preview.table.delimiter === "\t" ? "tab" : preview.table.delimiter}
                  </code>
                </p>
              </div>
              <div className="flex gap-2">
                <button className="btn btn-secondary" onClick={() => setPreview(null)}>
                  Cancelar
                </button>
                <button className="btn btn-primary" onClick={confirmImport}>
                  <CheckCircle size={14} />
                  Guardar importação
                </button>
              </div>
            </div>

            {preview.table.malformedRows > 0 && (
              <p
                className="mb-3 flex items-start gap-2 rounded-md p-3 text-sm"
                style={{ border: "1px solid var(--c-mid)", background: "hsl(38 92% 58% / 0.08)", color: "var(--c-mid)" }}
              >
                <Warning size={16} className="mt-0.5 shrink-0" />
                {preview.table.malformedRows.toLocaleString("pt-BR")} linhas têm número de colunas
                diferente do cabeçalho. Elas serão importadas, mas vale conferir se o arquivo saiu
                completo.
              </p>
            )}

            <p className="mb-2 text-sm font-medium">Colunas encontradas</p>
            <div className="mb-4 flex flex-wrap gap-1.5">
              {preview.table.headers.map((h, i) => {
                const kind = guessColumnKind(preview.table.rows.map((r) => r[i] ?? ""));
                return (
                  <span
                    key={`${h}-${i}`}
                    className={cn("rounded-md border px-2 py-1 text-xs", KIND_STYLE[kind])}
                    title={`Tipo detectado: ${kind}`}
                  >
                    {h || <em className="opacity-60">(sem nome)</em>}
                    <span className="ml-1.5 opacity-60">{kind}</span>
                  </span>
                );
              })}
            </div>

            <p className="mb-2 text-sm font-medium">Primeiras linhas</p>
            <div className="overflow-x-auto">
              <table className="table" style={{ minWidth: 600 }}>
                <thead>
                  <tr>
                    {preview.table.headers.map((h, i) => (
                      <th key={`${h}-${i}`} className="whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.table.rows.slice(0, 8).map((row, ri) => (
                    <tr key={ri}>
                      {preview.table.headers.map((_, ci) => (
                        <td key={ci} className="max-w-[220px] truncate whitespace-nowrap text-muted-foreground">
                          {row[ci] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Histórico */}
        <div className="card elev-sm !p-[18px]">
          <p className="card-title mb-3">Importações guardadas</p>
          {imports.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Envie um relatório acima para começar.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {imports.map((imp) => (
                <div
                  key={imp.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold">{imp.fileName}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {imp.rowCount.toLocaleString("pt-BR")} linhas · {imp.headers.length} colunas ·{" "}
                      {new Date(imp.importedAt).toLocaleString("pt-BR")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="tag tag-outline">aguardando mapeamento</span>
                    <button
                      onClick={() => remove(imp.id)}
                      title="Remover importação"
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger"
                    >
                      <Trash size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
