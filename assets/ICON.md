# Ícone Lumen

`lumen-gem.png` é a imagem mestre com transparência, editada com Imagegen a partir do ícone original. A gema mantém as facetas verdes e peroladas e aparece sem o quadrado preto, borda ou cantos brancos.

Pedido usado: preservar a identidade e as proporções da gema facetada original; remover todo o fundo e a moldura; centralizar e ampliar a gema em uma tela quadrada com transparência real; não adicionar texto, brilho externo ou sombra.

Para gerar os tamanhos de distribuição após instalar as dependências:

```sh
node scripts/generate_icons.js
```

O script preserva o canal alpha e usa o gerador do Tauri para os arquivos ICO, ICNS e PNG do desktop. A gema ocupa 92% da altura no desktop. No Android, ocupa 60% da tela adaptativa de 108 dp, dentro da área segura de 66 dp; o launcher recorta e amplia essa camada. A camada de fundo é transparente. Launchers e temas podem aplicar sua própria forma ou fundo.
