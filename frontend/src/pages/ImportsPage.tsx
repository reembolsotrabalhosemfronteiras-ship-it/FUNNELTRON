import { useEffect, useRef, useState } from "react";
import {
  UploadSimple as Upload,
  FileCsv as FileSpreadsheet,
  Trash as Trash2,
  Warning as AlertTriangle,
  CheckCircle as CheckCircle2,
  WarningCircle as FileWarning,
} from "@phosphor-icons/react";
import { Header } from "@/components/common/Header";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/common/Card";
import { Badge } from "@/components/common/Badge";
import { Button } from "@/components/common/Button";
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
  dinheiro: "bg-success/15 text-success border-success/30",
  número: "bg-primary/10 text-primary border-primary/30",
  data: "bg-warning/15 text-warning border-warning/30",
  texto: "bg-muted text-muted-foreground border-border",
  vazia: "bg-danger/10 text-danger border-danger/30",
};

export function ImportsPage() {
  const [imports, setImports] = useState<SalesImport[]>([]);
  const [preview, setPreview] = useState<{
    name: string;
    table: ParsedTable;
  } | null>(null);
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
        "Arquivo Excel ainda não é lido — o app não tem biblioteca de planilha instalada. Exporte como CSV na UTMify, ou peça para eu adicionar o suporte a XLSX."
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
      // Guardamos uma amostra, não o arquivo inteiro: localStorage tem ~5MB e
      // relatório de vendas grande estoura fácil.
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
      <Header
        title="Importações"
        subtitle="Relatórios de vendas da UTMify"
      />

      <main className="space-y-6 p-4">
        {/* Aviso honesto sobre o estágio atual */}
        <Card className="border-warning/40">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning" />
            <div className="text-sm">
              <p className="font-medium">
                O arquivo é lido e as colunas são identificadas — mas ainda não
                viram métrica.
              </p>
              <p className="mt-1 text-muted-foreground">
                Falta o mapeamento das colunas da UTMify para os campos internos
                (receita, taxas, gasto em anúncio, UTMs) e as regras que dizem
                de qual funil veio cada venda. Importe um relatório real aqui:
                os cabeçalhos que aparecerem são exatamente o que preciso para
                escrever esse mapeamento.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Área de upload */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload size={18} className="text-primary" />
              Enviar relatório
            </CardTitle>
            <CardDescription>
              CSV ou TSV exportado da UTMify · o separador é detectado sozinho
            </CardDescription>
          </CardHeader>
          <CardContent>
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
                "cursor-pointer rounded-lg border-2 border-dashed px-4 py-10 text-center transition-colors",
                dragging
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50 hover:bg-muted/40"
              )}
            >
              <FileSpreadsheet
                size={32}
                className="mx-auto mb-2 text-muted-foreground"
              />
              <p className="text-sm font-medium">
                Arraste o arquivo aqui ou clique para escolher
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                .csv · .tsv · .txt
              </p>
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
              <p className="mt-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
                <FileWarning size={16} className="mt-0.5 shrink-0" />
                {error}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Prévia do que foi lido */}
        {preview && (
          <Card className="border-primary/40">
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>Prévia: {preview.name}</CardTitle>
                  <CardDescription>
                    {preview.table.rows.length.toLocaleString("pt-BR")} linhas ·{" "}
                    {preview.table.headers.length} colunas · separador{" "}
                    <code className="rounded bg-muted px-1">
                      {preview.table.delimiter === "\t"
                        ? "tab"
                        : preview.table.delimiter}
                    </code>
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPreview(null)}>
                    Cancelar
                  </Button>
                  <Button size="sm" onClick={confirmImport}>
                    <CheckCircle2 size={14} />
                    Guardar importação
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {preview.table.malformedRows > 0 && (
                <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  {preview.table.malformedRows.toLocaleString("pt-BR")} linhas
                  têm número de colunas diferente do cabeçalho. Elas serão
                  importadas, mas vale conferir se o arquivo saiu completo.
                </p>
              )}

              <div>
                <p className="mb-2 text-sm font-medium">Colunas encontradas</p>
                <div className="flex flex-wrap gap-1.5">
                  {preview.table.headers.map((h, i) => {
                    const kind = guessColumnKind(
                      preview.table.rows.map((r) => r[i] ?? "")
                    );
                    return (
                      <span
                        key={`${h}-${i}`}
                        className={cn(
                          "rounded-md border px-2 py-1 text-xs",
                          KIND_STYLE[kind]
                        )}
                        title={`Tipo detectado: ${kind}`}
                      >
                        {h || <em className="opacity-60">(sem nome)</em>}
                        <span className="ml-1.5 opacity-60">{kind}</span>
                      </span>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium">Primeiras linhas</p>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        {preview.table.headers.map((h, i) => (
                          <th
                            key={`${h}-${i}`}
                            className="whitespace-nowrap px-2 py-1.5 text-left font-medium"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.table.rows.slice(0, 8).map((row, ri) => (
                        <tr key={ri} className="border-t border-border">
                          {preview.table.headers.map((_, ci) => (
                            <td
                              key={ci}
                              className="max-w-[220px] truncate whitespace-nowrap px-2 py-1.5 text-muted-foreground"
                            >
                              {row[ci] ?? ""}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Histórico */}
        <Card>
          <CardHeader>
            <CardTitle>Importações guardadas</CardTitle>
            <CardDescription>
              {imports.length === 0
                ? "Nenhum relatório importado ainda"
                : `${imports.length} ${imports.length === 1 ? "arquivo" : "arquivos"}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {imports.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Envie um relatório acima para começar.
              </p>
            ) : (
              <div className="space-y-2">
                {imports.map((imp) => (
                  <div
                    key={imp.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {imp.fileName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {imp.rowCount.toLocaleString("pt-BR")} linhas ·{" "}
                        {imp.headers.length} colunas ·{" "}
                        {new Date(imp.importedAt).toLocaleString("pt-BR")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="warning">aguardando mapeamento</Badge>
                      <button
                        onClick={() => remove(imp.id)}
                        title="Remover importação"
                        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
