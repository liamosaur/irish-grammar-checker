// Every piece of interface text lives here (English). Add an Irish value for
// any key in ga.ts and it is used instead; missing keys fall back to this file.
// Placeholders look like {n}. Links in text look like [words](https://...).
// Keys ending in .one / .other are picked by count (see tn() in ../strings.ts).

export const en = {
  'page.title': '{app}',

  'nav.skip': 'Skip to the text box',
  'nav.how': 'How it works',
  'nav.about': 'About',
  'nav.label': 'Site',
  'nav.home': '{app} home',

  'loading.first': 'First visit only: about 3 MB to download. Your browser keeps it afterwards.',
  'loading.download': 'Getting ready… {pct}%',
  'loading.prepare': 'Getting ready…',
  'loading.fromCache': 'Getting ready…',
  'loading.fail.title': 'The checker could not be loaded',
  'loading.fail.body': 'This is usually a network problem. Nothing you typed has been lost. Details: {message}',
  'loading.retry': 'Try again',
  'loading.crashed': 'the checker stopped unexpectedly',

  'editor.region': 'Editor',
  'editor.label': 'Your Irish text',
  'editor.placeholder': 'Write or paste Irish here…',
  'editor.long': 'This is a long text. Checking runs in the background and can be cancelled.',
  'btn.check': 'Check',
  'btn.example': 'Try an example',
  'btn.clear': 'Clear',
  'btn.cancel': 'Cancel',
  'btn.edit': 'Edit text',
  'btn.close': 'Close',

  'status.loading': 'Getting ready…',
  'status.empty': 'Write or paste some Irish first.',
  'status.checking': 'Checking… {pct}%',
  'status.checkingShort': 'Checking…',
  'status.waiting': 'Almost ready. Your text will be checked in a moment…',
  'status.error': 'Something went wrong while checking: {message}',

  'result.none': 'Nothing to flag',
  'result.count.one': '1 thing to check',
  'result.count.other': '{n} things to check',
  'result.noneNote': 'That is not a guarantee. The checker only knows certain kinds of mistake.',
  'result.unreadable.one': '{n} character the checker cannot read (such as an emoji) was skipped.',
  'result.unreadable.other': '{n} characters the checker cannot read (such as emoji) were skipped.',

  'text.group.none': 'Your text. Nothing flagged.',
  'text.group.one': 'Your text, with 1 passage marked.',
  'text.group.other': 'Your text, with {n} passages marked.',
  'list.line': 'line {n}',
  'list.unaligned': 'This could not be located in your text, so it is not highlighted.',
  'err.sr': 'Note {n}',
  'sugg.apply': 'Replace with {word}',
  'sugg.label': 'Did you mean',
  'why.label': 'Why:',
  'why.ref': '(An Caighdeán Oifigiúil {section})',

  'how.title': 'How it works',
  'how.1': 'Write or paste Irish text and press Check.',
  'how.2': 'Passages that may contain a mistake are highlighted. Select one, or its note below, to see what the checker noticed.',
  'how.3': 'You can click on the suggested change and your text will be updated with the suggestion.',
  'how.limits.h': 'Worth knowing',
  'how.limits.1': 'It follows a long list of written grammar rules. These rules are not perfect - it can miss mistakes and sometimes flag text that is fine. If you notice any mistakes, [I\'d love to hear about them](https://github.com/liamosaur/irish-grammar-checker/issues)!',
  'how.limits.2': 'Treat it as a learning tool. If you need text to be professionally proofed, engage the services of a professional proofer/translator.',
  'how.limits.3': 'For an unknown word it may offer words that are spelled similarly. They are guesses based on spelling alone. Names, new words and dialect forms may be flagged because they are not in its word list.',
  'how.limits.4': 'Everything runs in your browser, and your text never leaves it. The grammar checking algorithm does not use generative AI.',
  'how.about': 'For credits and licences, see [About](#about).',

  'footer.credit': 'Based on [An Gramadóir](https://github.com/kscanne/gramadoir) by Kevin P. Scannell.',

  'about.title': 'About',
  'about.what': 'A grammar checker for Irish. It marks words and phrases that look wrong, such as a missing or unnecessary mutation, a repeated word or a non-standard spelling, and says why. [It may make mistakes](#how).',
  'about.author': 'This website was made by [Liam O](https://bsky.app/profile/liamosar.bsky.social).',
  'about.credits.1': 'This tool is a port of [An Gramadóir](https://cadhan.com/gramadoir/foirm-en.html), the Irish grammar checker written by Kevin P. Scannell, available at [github.com/kscanne/gramadoir](https://github.com/kscanne/gramadoir). The grammar rules and most of the word list come from his work. It is a derivative work, released under the GNU General Public License, version 2 or (at your option) any later version.',
  'about.credits.2': 'The word list also contains information from the Irish National Morphology Database (Bunachar Náisiúnta Moirfeolaíochta), © Foras na Gaeilge, available at [github.com/michmech/BuNaMo](https://github.com/michmech/BuNaMo). The database is made available under the [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1.0/), and its individual contents under the [Database Contents License 1.0](https://opendatacommons.org/licenses/dbcl/1.0/). Only word forms, which forms belong to the same word (for example, which is the genitive of which), and grammatical tags derived from them are used.',
  'about.source': 'The source code of this site is at [github.com/liamosaur/irish-grammar-checker](https://github.com/liamosaur/irish-grammar-checker).',
  'about.how':'For how to use the checker, and its limits, see [How it works](#how).',
  'about.credits.3': 'This site is not affiliated with or endorsed by Kevin P. Scannell, the original An Gramadóir project, or Foras na Gaeilge.',
} as const;

export type StringKey = keyof typeof en;
