# Testes

100% de cobertura de teste é o que torna vibe coding seguro. Testes deixam
mexer rápido, confiar no instinto e publicar com confiança — sem eles, vibe
coding é só yolo coding. Com testes, vira um superpoder.

## Frontend

Framework: **Vitest** + **@testing-library/react** (o par natural de um projeto
Vite + React — mesmo motor de build do dev server, sem config duplicada).

```bash
cd frontend
npm test          # roda uma vez
npm run test:watch  # modo watch
```

Config: `frontend/vitest.config.ts`. Setup global (jest-dom matchers):
`frontend/src/test/setup.ts`.

### Camadas

- **Unit** — funções puras em `src/lib/*.ts` (cálculo de métricas, formatação).
  É onde mora a maior parte da lógica de negócio deste app — cada bug de
  cálculo já visto aqui (conversão, visitantes, tempo de página) nasceu nessas
  funções, então são o alvo de teste mais valioso.
- **Integration** — componentes que combinam dado + apresentação (ainda não
  cobertos; próximo passo natural é `src/pages/*.tsx` com dado mockado).
- **E2E** — não configurado. O fluxo real (login, ateliê, ao vivo) hoje é
  verificado manualmente no navegador a cada mudança.

### Convenções

- Arquivo de teste ao lado do arquivo testado: `funnelStats.ts` →
  `funnelStats.test.ts`.
- `describe` agrupa por função; cada `it` testa UM comportamento, nomeado em
  português como o resto do código.
- Teste o que a função FAZ (valor calculado), nunca `expect(x).toBeDefined()`.
- Quando um teste existe pra registrar um bug já corrigido, o comentário no
  teste explica qual era o bug — não só o que o teste verifica.
