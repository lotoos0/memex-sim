# Token image attribution

Every file in this directory, including `authors/`, is an original synthetic image created for memex-sim. Nothing here is scraped, traced from a meme, or a photograph of a real person. Character coins (politics, cartoons, holidays) use original animal and object mascots rather than likenesses of real people or copyrighted characters.

License: MIT, the same terms as the repository [LICENSE](../../LICENSE).

## How to add an image

1. Drop a square image into `public/token-images/`. Author portraits go in `public/token-images/authors/`.
2. Append an entry in `src/lib/tokenImageCatalog.ts`.
   - Token images: `TOKEN_IMAGE_CATALOG`, with `themes` (the matching group) and optional `tags`.
   - Author portraits: `AUTHOR_IMAGE_CATALOG`.
3. Tags are name modifiers: `baby`, `mini`, `smol`, `sleepy`, `lazy`, `angry`, `chad`, `giga`, `gigachad`, `mega`, `turbo`. A token whose name contains that modifier prefers images with the tag when any exist in the theme.
4. To match a new word in a token name, append `{ word, theme }` to `THEME_KEYWORDS`. `word` is matched in uppercase. The noun at the end of the name wins over a shorter word inside it (`POPCAT` beats `CAT`, `DOGE` beats `DOG`).
5. Add a row to the table below with the file name and a one-line description of the source.

`generateToken` calls `pickTokenImageUrl({ id, name, ticker })` once and stores the public path on `TokenMeta.imageUrl`. Inside the matching group each image is scored by a hash of the token id plus the image id, and the highest score wins, so the same token keeps the same image. Adding a file only changes tokens that score higher for the new image. Names that match no keyword keep the procedural SVG avatar from `src/lib/tokenAvatar.ts`.

## Token images

| File | Themes | What it is |
| --- | --- | --- |
| `dog-shiba.webp` | dog | Original shiba portrait |
| `dog-puppy.webp` | dog, smol | Original shiba puppy. Tags: baby, mini, smol |
| `dog-cowboy.webp` | dog | Original shiba in a cowboy hat. Tags: chad, giga, gigachad |
| `dog-sleepy.webp` | dog | Original sleepy shiba. Tags: sleepy, lazy |
| `cat-orange.webp` | cat | Original orange tabby |
| `cat-yawn.webp` | cat | Original yelling cat. Tags: giga, mega |
| `cat-kitten.webp` | cat, smol | Original kitten. Tags: baby, mini, smol |
| `frog-grin.webp` | frog | Original frog, not Pepe |
| `frog-hoodie.webp` | frog | Original frog in a hoodie. Tag: chad |
| `frog-tiny.webp` | frog, smol | Original baby frog. Tags: baby, mini, smol |
| `ape-chain.webp` | ape | Original chimp with a chain. Tags: chad, giga, gigachad |
| `ape-baby.webp` | ape, smol | Original baby chimp. Tags: baby, smol |
| `rat-beanie.webp` | rat | Original rat in a beanie |
| `bear-grump.webp` | bear | Original grumpy bear. Tag: angry |
| `bear-sleepy.webp` | bear | Original sleepy bear. Tags: sleepy, lazy |
| `bull-gold.webp` | bull | Original bull |
| `goat-beard.webp` | goat | Original goat |
| `squirrel-peanut.webp` | squirrel | Original squirrel with a peanut |
| `robot-visor.webp` | ai, tech | Original robot head |
| `robot-orb.webp` | ai, tech | Original one-eyed robot. Tags: baby, smol |
| `rocket-face.webp` | rocket, moon | Original cartoon rocket. Tag: turbo |
| `politics-corgi.webp` | politics | Original corgi in a plain cap, not a real person |
| `politics-eagle.webp` | politics | Original eagle. Tag: giga |
| `toon-blob.webp` | toon | Original blob mascot |
| `toon-pickle.webp` | toon | Original pickle mascot |
| `car-gold.webp` | car | Generic sports car with no badges |
| `trader-hoodie.webp` | trader | Original sad hoodie character, not the Wojak drawing |
| `clown-frog.webp` | clown | Original clown frog |
| `penguin-scarf.webp` | chill | Original penguin |
| `food-pizza.webp` | food | Original pizza slice |
| `food-burger.webp` | food | Original burger |
| `food-ramen.webp` | food | Original ramen bowl |
| `monk-raccoon.webp` | monk | Original raccoon in a plain robe, not a religious figure |
| `halo-lamb.webp` | halo | Original lamb, not a religious figure |
| `holiday-corgi.webp` | holiday | Original corgi in a winter hat, not Santa as a person |
| `royal-lion.webp` | royal | Original lion with a crown |
| `chad-helmet.webp` | chad | Original helmeted corgi, not a real person. Tags: giga, gigachad |

## Author portraits

Illustrated fictional people for news and post avatars. Not photographs and not celebrities.

| File | What it is |
| --- | --- |
| `authors/author-hoodie.webp` | Original cartoon person in a hoodie |
| `authors/author-glasses.webp` | Original cartoon person with glasses |
| `authors/author-cap.webp` | Original cartoon person in a cap |
| `authors/author-beanie.webp` | Original cartoon person in a beanie |
| `authors/author-bob.webp` | Original cartoon person with a bob haircut |
| `authors/author-curly.webp` | Original cartoon person with curly hair |
