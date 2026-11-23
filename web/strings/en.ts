// Every piece of interface text lives here (English). Add an Irish value for
// any key in ga.ts and it is used instead; missing keys fall back to this file.
// Placeholders look like {n}. Links in text look like [words](https://...).
// Keys ending in .one / .other are picked by count (see tn() in ../strings.ts).
// Each entry starts with the status of its English text (test/web.test.ts checks it has one):
//   unreviewed  written or changed by Claude, not yet approved by Liam
//   reviewed    approved by Liam
// (as for the messages and reasons in grammar/; see tools/README.md, "Text status").

export const en = {
  /* unreviewed */ 'page.title': '{app}',

  /* unreviewed */ 'nav.skip': 'Skip to the text box',
  /* unreviewed */ 'nav.how': 'How it works',
  /* unreviewed */ 'nav.about': 'About',
  /* unreviewed */ 'nav.label': 'Site',
  /* unreviewed */ 'nav.home': '{app} home',

  /* unreviewed */ 'loading.first': 'First visit only: about 3 MB to download. Your browser keeps it afterwards.',
  /* unreviewed */ 'loading.download': 'Getting ready… {pct}%',
  /* unreviewed */ 'loading.prepare': 'Getting ready…',
  /* unreviewed */ 'loading.fromCache': 'Getting ready…',
  /* unreviewed */ 'loading.fail.title': 'The checker could not be loaded',
  /* unreviewed */ 'loading.fail.body': 'This is usually a network problem. Nothing you typed has been lost. Details: {message}',
  /* unreviewed */ 'loading.retry': 'Try again',
  /* unreviewed */ 'loading.crashed': 'the checker stopped unexpectedly',

  /* unreviewed */ 'editor.region': 'Editor',
  /* unreviewed */ 'editor.label': 'Your Irish text',
  /* unreviewed */ 'editor.placeholder': 'Write or paste Irish here…',
  /* unreviewed */ 'editor.long': 'This is a long text. Checking runs in the background and can be cancelled.',
  /* unreviewed */ 'btn.check': 'Check',
  /* unreviewed */ 'btn.example': 'Try an example',
  /* unreviewed */ 'btn.clear': 'Clear',
  /* unreviewed */ 'btn.cancel': 'Cancel',
  /* unreviewed */ 'btn.edit': 'Edit text',
  /* unreviewed */ 'btn.close': 'Close',

  /* unreviewed */ 'status.loading': 'Getting ready…',
  /* unreviewed */ 'status.empty': 'Write or paste some Irish first.',
  /* unreviewed */ 'status.checking': 'Checking… {pct}%',
  /* unreviewed */ 'status.checkingShort': 'Checking…',
  /* unreviewed */ 'status.waiting': 'Almost ready. Your text will be checked in a moment…',
  /* unreviewed */ 'status.error': 'Something went wrong while checking: {message}',

  /* unreviewed */ 'result.none': 'Nothing to flag',
  /* unreviewed */ 'result.count.one': '1 thing to check',
  /* unreviewed */ 'result.count.other': '{n} things to check',
  /* unreviewed */ 'result.noneNote': 'That is not a guarantee. The checker only knows certain kinds of mistake.',
  /* unreviewed */ 'result.unreadable.one': '{n} character the checker cannot read (such as an emoji) was skipped.',
  /* unreviewed */ 'result.unreadable.other': '{n} characters the checker cannot read (such as emoji) were skipped.',

  /* unreviewed */ 'text.group.none': 'Your text. Nothing flagged.',
  /* unreviewed */ 'text.group.one': 'Your text, with 1 passage marked.',
  /* unreviewed */ 'text.group.other': 'Your text, with {n} passages marked.',
  /* unreviewed */ 'list.line': 'line {n}',
  /* unreviewed */ 'list.unaligned': 'This could not be located in your text, so it is not highlighted.',
  /* unreviewed */ 'err.sr': 'Note {n}',
  /* unreviewed */ 'sugg.apply': 'Replace with {word}',
  /* unreviewed */ 'sugg.label': 'Did you mean',
  /* reviewed */ 'sugg.none': 'No suggested spelling could be found.',
  /* unreviewed */ 'why.label': 'Why:',
  /* unreviewed */ 'why.ref': '(An Caighdeán Oifigiúil {section})',

  /* unreviewed */ 'how.title': 'How it works',
  /* unreviewed */ 'how.1': 'Write or paste Irish text and press Check.',
  /* unreviewed */ 'how.2': 'Passages that may contain a mistake are highlighted. Select one, or its note below, to see what the checker noticed.',
  /* unreviewed */ 'how.3': 'Where a change is suggested, you can click on it and your text will be updated with the suggestion.',
  /* unreviewed */ 'how.limits.h': 'Worth knowing',
  /* unreviewed */ 'how.limits.1': 'It follows a long list of written grammar rules. These rules are not perfect - it can miss mistakes and sometimes flag text that is fine. If you notice any mistakes, [I\'d love to hear about them](https://github.com/liamosaur/irish-grammar-checker/issues)!',
  /* unreviewed */ 'how.limits.2': 'Treat it as a learning tool. If you need text to be professionally proofed, engage the services of a professional proofer/translator.',
  /* unreviewed */ 'how.limits.3': 'For an unknown word it may offer words that are spelled similarly. They are guesses based on spelling alone. Names, new words and dialect forms may be flagged because they are not in its word list.',
  /* unreviewed */ 'how.limits.4': 'Everything runs in your browser, and your text never leaves it. The grammar checking algorithm does not use generative AI.',
  /* unreviewed */ 'how.about': 'For credits and licences, see [About](#about).',

  /* unreviewed */ 'footer.credit': 'Based on [An Gramadóir](https://github.com/kscanne/gramadoir) by Kevin P. Scannell.',

  /* unreviewed */ 'about.title': 'About',
  /* unreviewed */ 'about.what': 'A grammar checker for Irish. It marks words and phrases that look wrong, such as a missing or unnecessary mutation, a repeated word or a non-standard spelling, and says why. [It may make mistakes](#how).',
  /* unreviewed */ 'about.author': 'This website was made by [Liam O](https://bsky.app/profile/liamosar.bsky.social).',
  /* unreviewed */ 'about.credits.1': 'This tool is originally based on [An Gramadóir](https://cadhan.com/gramadoir/foirm-en.html), the Irish grammar checker written by Kevin P. Scannell, available at [github.com/kscanne/gramadoir](https://github.com/kscanne/gramadoir). The word list mostly comes from his work. Gramadóir is based on grammar rules from the 1994 Christian Brothers Grammar textbook. The grammar rules in this version are based instead on Caighdeán Oifigiúil 2017. It is a derivative work, released under the GNU General Public License, version 2 or (at your option) any later version.',
  /* unreviewed */ 'about.credits.2': 'The word list also contains information from the Irish National Morphology Database (Bunachar Náisiúnta Moirfeolaíochta), © Foras na Gaeilge, available at [github.com/michmech/BuNaMo](https://github.com/michmech/BuNaMo). The database is made available under the [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1.0/), and its individual contents under the [Database Contents License 1.0](https://opendatacommons.org/licenses/dbcl/1.0/). Only word forms, which forms belong to the same word (for example, which is the genitive of which), and grammatical tags derived from them are used.',
  /* unreviewed */ 'about.source': 'The source code of this site is at [github.com/liamosaur/irish-grammar-checker](https://github.com/liamosaur/irish-grammar-checker).',
  /* unreviewed */ 'about.how':'For how to use the checker, and its limits, see [How it works](#how).',
  /* unreviewed */ 'about.credits.co17': 'The explanations shown with each error cite and quote An Caighdeán Oifigiúil (2017), © Houses of the Oireachtas.',
  /* unreviewed */ 'about.credits.3': 'This site is not affiliated with or endorsed by Kevin P. Scannell, the original An Gramadóir project, Foras na Gaeilge, or the Houses of the Oireachtas.',
} as const;

export type StringKey = keyof typeof en;
