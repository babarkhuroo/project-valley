/**
 * Words masked in Valley chat (and player names). Compared after folding look-alike
 * characters (0→o, 1→i, $→s…), and any letter may repeat, so "sh1iiit" counts as "shit"
 * (a doubled letter still needs at least two: "nigg" never matches "night").
 *
 * `exact`: masked only as a whole word ("ass", not "assist").
 * `prefix`: masked when a word starts with it ("fucking", "shitty") — never inside a
 * word, so place names like Scunthorpe stay readable.
 */
export const CHAT_FILTER = {
  exact: [
    'ass', 'asses', 'arse', 'bitch', 'bitches', 'bollocks', 'boner', 'cock', 'cocks', 'dick', 'dicks', 'dyke', 'fag', 'fags',
    'jizz', 'kys', 'nazi', 'piss', 'porn', 'prick', 'pussy', 'rape', 'raped', 'retard', 'retarded', 'slut',
    'sluts', 'spic', 'tits', 'twat', 'wank', 'whore', 'whores', 'chink', 'kike', 'gook', 'wetback', 'tranny',
    'coon', 'paki', 'nonce', 'cum',
  ],
  prefix: [
    'fuck', 'fuk', 'fck', 'motherfuck', 'shit', 'bullshit', 'cunt', 'cocksuck', 'nigg', 'niga', 'faggot', 'fagot', 'asshole',
    'arsehole', 'dickhead', 'bastard', 'wanker', 'whore', 'slutt', 'retard', 'rapist', 'pedo', 'paedo', 'molest',
    'killyourself', 'dildo', 'blowjob', 'handjob', 'porno', 'hentai', 'jackass', 'dumbass', 'beaner', 'raghead', 'towelhead',
  ],
};
