# Installer un VSIX local

Un fichier `.vsix` installe la preview dans VS Code. Plusieurs livraisons peuvent coexister dans ce dossier : utilisez le fichier indiqué dans la livraison que vous souhaitez tester.

## Depuis VS Code

1. Ouvrez **Extensions → … → Installer à partir d’un VSIX**.
2. Sélectionnez le fichier fourni.
3. Lancez **Developer: Reload Window**.

## Depuis le terminal

Remplacez le chemin ci-dessous par celui du VSIX choisi :

```sh
code --install-extension "/chemin/vers/la-livraison.vsix" --force
```

L’installation ne crée aucune ressource Scaleway. Les fichiers VSIX sont des livraisons locales, pas une publication Marketplace.

## Après installation

Ouvrez la vue **Scaleway AI**, puis suivez le [guide d’utilisation](../apps/vscode-extension/README.md).
