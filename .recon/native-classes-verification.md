# Jellyfin 10.11.8 Native Class Chain Verification

Re-extracted from the live NAS bundle at `http://192.168.1.165:7900/web/`. Bundle hash `bd97e362c032911dbc8f`. Server version verified via `/System/Info/Public` → 10.11.8. The `index.html` lists `runtime.bundle.js?bd97e362c032911dbc8f`; the runtime carries a chunk-hash table mapping numeric chunk IDs to their hashes plus a name table. We pulled 698 chunks out of 927 (the rest 404 — async-only chunks that were never published, fine for our purposes); plus verified missing pieces (item detail page HTML template, toast component) directly against the tagged GitHub source for `v10.11.8`.

All quotes below are verbatim from the live bundle unless explicitly tagged "GitHub source v10.11.8" (used only where webpack tree-shook the legacy HTML/CSS templates out of the published chunks).

---

## 1. Home-page row chrome (verticalSection container)

Live bundle path `/web/56213.a6cde3c8ba80d7030952.chunk.js` — the `loadSections` module that the React home renderer dispatches into via `t(7062)("./hometab")`.

### 1a. LatestMedia ("Latest in <Library>") row

`56213.a6cde3c8ba80d7030952.chunk.js` lines 848–865 (pretty-printed):

```
o+='<div class="sectionTitleContainer sectionTitleContainer-cards padded-left">',
n.A.tv?o+='<h2 class="sectionTitle sectionTitle-cards">'+s.Ay.translate("LatestFromLibrary",m()(i.Name))+"</h2>"
       :(o+='<a is="emby-linkbutton" href="'+p.appRouter.getRouteUrl(i,{section:"latest"})+'" class="more button-flat button-flat-mini sectionTitleTextButton">',
         o+='<h2 class="sectionTitle sectionTitle-cards">',
         o+=s.Ay.translate("LatestFromLibrary",m()(i.Name)),
         o+="</h2>",
         o+='<span class="material-icons chevron_right" aria-hidden="true"></span>',
         o+="</a>"),
o+="</div>",
a.enableOverflow?(o+='<div is="emby-scroller" class="padded-top-focusscale padded-bottom-focusscale" data-centerfocus="true">',
                  o+='<div is="emby-itemscontainer" class="itemsContainer scrollSlider focuscontainer-x">')
              :o+='<div is="emby-itemscontainer" class="itemsContainer focuscontainer-x padded-left padded-right vertical-wrap">',
a.enableOverflow&&(o+="</div>"),
o+="</div>",
```

Note: the outer `<div class="verticalSection">` wrapper for LatestMedia is created in JS, not the HTML string — `e.classList.remove("verticalSection")` then `i.classList.add("verticalSection")` (per-library wrapper) at lines 658–663 of the same chunk. The whole row therefore is:

```html
<div class="verticalSection">
  <div class="sectionTitleContainer sectionTitleContainer-cards padded-left">
    <a is="emby-linkbutton" href="#/list?...&section=latest" class="more button-flat button-flat-mini sectionTitleTextButton">
      <h2 class="sectionTitle sectionTitle-cards">Latest in Movies</h2>
      <span class="material-icons chevron_right" aria-hidden="true"></span>
    </a>
  </div>
  <div is="emby-scroller" class="padded-top-focusscale padded-bottom-focusscale" data-centerfocus="true">
    <div is="emby-itemscontainer" class="itemsContainer scrollSlider focuscontainer-x">
      <!-- cards here -->
    </div>
  </div>
</div>
```

### 1b. Resume / NextUp row (the C(...) factory)

`56213.a6cde3c8ba80d7030952.chunk.js` lines 588–603:

```
function C(e,t,r,i,n,a){
  var o,l="",c=null!==(o=T[i])&&void 0!==o?o:"markplayed";
  l+='<h2 class="sectionTitle sectionTitle-cards padded-left">'+s.Ay.translate(r)+"</h2>",
  a.enableOverflow?(
    l+='<div is="emby-scroller" class="padded-top-focusscale padded-bottom-focusscale" data-centerfocus="true">',
    l+='<div is="emby-itemscontainer" class="itemsContainer scrollSlider focuscontainer-x" data-monitor="'.concat(c,'">')
  ):l+='<div is="emby-itemscontainer" class="itemsContainer padded-left padded-right vertical-wrap focuscontainer-x" data-monitor="'.concat(c,'">'),
  a.enableOverflow&&(l+="</div>"),
  l+="</div>",
```

So Resume/NextUp produces a *bare* `<h2>` with no `sectionTitleContainer` wrapper (because it's not clickable through to a "see all" page).

### 1c. The `<div class="verticalSection sectionN">` lazy stub

The home-tab outer container is filled by `21152.3c9de3369a58d9bb0f9b.chunk.js`, which writes one stub per section before the per-section markup is fetched:

```
c+='<div class="verticalSection section'+o[v].id+'"></div>'
```

(File `24871.3ea5154a81e4ab458386.chunk.js` does the same for the Favorites tab.)

### 1d. Scroller arrows

`99883.38906bd0fc88baa9f146.chunk.js` (the React `Scroller` component used by the React-rendered home rails — `Discover`, library rails on the favorites tab, etc.):

```js
(null===(e=o.current)||void 0===e?void 0:e.parentNode).classList.add("emby-scroller-container");
...
return (0,l.jsxs)("div",{ref:o,className:"emby-scrollbuttons padded-right",children:[
  (0,l.jsx)(Le,{type:"button",className:"emby-scrollbuttons-button btnPrev",onClick:c,icon:"chevron_left",disabled:i<=0}),
  (0,l.jsx)(Le,{type:"button",className:"emby-scrollbuttons-button btnNext",onClick:d,icon:"chevron_right",
                disabled:r.scrollWidth>0&&i+r.scrollSize>=r.scrollWidth})
]})
```

So the arrow markup the legacy `emby-scroller` web component injects (`is="emby-scroller"` on the host `<div>`) follows the same `emby-scrollbuttons / emby-scrollbuttons-button btnPrev|btnNext` pattern, and the host's *parentNode* gets the `emby-scroller-container` class (not the host itself).

The scroll-buttons `<button>` body uses `material-icons chevron_left` / `chevron_right`.

### 1e. Padding behaviour

The `emby-itemscontainer` inside `emby-scroller` does **not** have `padded-left padded-right` (the wrapping `<div class="emby-scroller-container">` handles edge alignment via CSS). The non-overflow fallback (`vertical-wrap`) variant **does** add `padded-left padded-right`.

---

## 2. Card markup (portrait, the kind used for Movies/Books/Comics)

Live bundle path `/web/24468.50f2991bf78868105780.chunk.js` (the `cardBuilder` module that emits all card markup in the home rails, library lists and the legacy detail-page rails).

### 2a. Outer card class chain factory (`y` aka `C.a_` in the imports)

Lines 1257–1273:

```
y=function(e){
  var r;
  return o()(((r={card:!0})
    ["".concat(e.shape,"Card")]=e.shape,
    r["".concat(e.cardCssClass)]=e.cardCssClass,
    r["".concat(e.cardClass)]=e.cardClass,
    r["card-hoverable"]=e.isDesktop,
    r["show-focus"]=e.isTV,
    r["show-animation"]=e.isTV&&e.enableFocusTransform,
    r.groupedCard=e.showChildCountIndicator&&e.childCount,
    r["card-withuserdata"]=!["MusicAlbum","MusicArtist","Audio"].includes(e.itemType),
    r.itemAction="button"===e.tagName,
    r))
}
```

So a portrait book card on desktop has:

```
card overflowPortraitCard card-hoverable card-withuserdata
```

(`overflowPortraitCard` because `shape="overflowPortrait"`, then `${shape}Card` → `overflowPortraitCard`.)

### 2b. cardBox / cardScalable / cardPadder structure

Lines 1281–1286 (cardBox factory):

```
v=function(e){
  return o()({
    cardBox:!0,
    visualCardBox:e.cardLayout,
    "cardBox-bottompadded":e.hasOuterCardFooter&&!e.cardLayout
  })
}
```

The actual emitted HTML chain is at lines 870–885 (`N=...` is the inner cardContent; outer is wrapped in cardBox + cardScalable + cardPadder):

```
N='<div class="'.concat(E,
  '"><div class="').concat("cardScalable",
  '"><div class="cardPadder cardPadder-').concat(u,
  '">').concat(X,
  "</div>").concat(N),
```

where `E` is the cardBox class chain and `u` is the shape (e.g. `overflowPortrait`). So:

```html
<div class="cardBox cardBox-bottompadded">
  <div class="cardScalable">
    <div class="cardPadder cardPadder-overflowPortrait">
      <span class="cardImageIcon material-icons folder" aria-hidden="true"></span> <!-- placeholder when no image -->
    </div>
    <a href="#/details?id=..." data-action="link" class="cardImageContainer ... cardContent itemAction lazy" data-src="..." aria-label="..." role="img">
    </a>
    <!-- overlay container, indicators -->
  </div>
  <!-- outer card footer -->
</div>
```

### 2c. cardImageContainer

Lines 1273–1280:

```
h=function(e){
  var r;
  return o()(((r={cardImageContainer:!0,
    coveredImage:e.hasCoverImage,
    "coveredImage-contain":e.hasCoverImage&&"TvChannel"===e.itemType
  })[f(e.itemName)]=!e.imgUrl,r))
}
```

So `cardImageContainer coveredImage` are the live class names. Image is set via `data-src="<imgUrl>"` (lazy-loaded, the `lazy` class is added when there is a `data-src`), NOT a `<img>` tag. CSS `background-image` swap by the lazy loader.

The wrapping element is **`<a>` on desktop, `<div>` on TV**, per line 853:

```
g.A.tv ? N=y?'<div class="'+w+" "+j+' lazy" data-src="'+y+'" '+J+">"
            :'<div class="'+w+" "+j+'">' ...
       : N=y?'<a href="'+G+'" data-action="'+c+'" class="'+w+" "+j+' itemAction lazy" data-src="'+y+'" '+J+z+">"
            :'<a href="'+G+'" data-action="'+c+'" class="'+w+" "+j+' itemAction"'+z+">"
```

### 2d. cardOverlayContainer + hover button

Lines 940–965:

```
a+='<div class="cardOverlayContainer itemAction" data-action="'+r+'">';
var n="cardOverlayButton cardOverlayButton-hover itemAction paper-icon-button-light";
T.f.canPlay(e)&&(
  a+='<button is="paper-icon-button-light" class="'.concat(n,
     ' cardOverlayFab-primary" data-action="resume" title="').concat(l.Ay.translate("Play"),
     '"><span class="material-icons cardOverlayButtonIcon cardOverlayButtonIcon-hover play_arrow" aria-hidden="true"></span></button>')
);
a+='<div class="cardOverlayButton-br flex">';
// playstate (mark-played), rating (favourite), more — all stamped with `n`
a+='<button is="paper-icon-button-light" class="'.concat(n,
   '" data-action="menu" title="').concat(l.Ay.translate("ButtonMore"),
   '"><span class="material-icons cardOverlayButtonIcon cardOverlayButtonIcon-hover more_vert" aria-hidden="true"></span></button>'),
return a+="</div></div>"
```

So the desktop hover overlay is:

```html
<div class="cardOverlayContainer itemAction" data-action="link">
  <button is="paper-icon-button-light"
          class="cardOverlayButton cardOverlayButton-hover itemAction paper-icon-button-light cardOverlayFab-primary"
          data-action="resume" title="Play">
    <span class="material-icons cardOverlayButtonIcon cardOverlayButtonIcon-hover play_arrow" aria-hidden="true"></span>
  </button>
  <div class="cardOverlayButton-br flex">
    <!-- mark-played, favourite, menu, all using the same n class chain -->
  </div>
</div>
```

The hover-reveal mechanism is **CSS-only** — the buttons live in the DOM at all times; the `card-hoverable` class on the outer card + CSS opacity transitions show them on `:hover`. JS does not toggle a class.

The icon uses **codepoint-class mode**: `<span class="material-icons play_arrow">` with no text — Jellyfin's font-loader maps `play_arrow` class to the codepoint. NOT ligature mode.

### 2e. cardIndicators

Line 896 (factory) and 1015–1027 (mutator):

```
W&&(N+='<div class="cardIndicators">'+W+"</div>")
```

Where `W` is built from `v.Ay.getMissingIndicator(r)` + `getSyncIndicator` + `getTimerIndicator` + `getTypeIndicator` + (`getChildCountIndicatorHtml` OR `getPlayedIndicatorHtml`). The `getPlayedIndicatorHtml` produces a `<div class="playedIndicator indicator">` with body `<span class="material-icons indicatorIcon check" aria-hidden="true"></span>`.

The mutator that adds the played tick at runtime (lines 1010–1024):

```
i.innerHTML='<span class="material-icons indicatorIcon check" aria-hidden="true"></span>'
```

So the played-tick markup is:

```html
<div class="cardIndicators">
  <div class="playedIndicator indicator">
    <span class="material-icons indicatorIcon check" aria-hidden="true"></span>
  </div>
  <!-- timerIndicator, mediaSourceIndicator etc. siblings -->
</div>
```

The favourite/rating star is rendered through the `emby-ratingbutton` web component (filled vs outline `favorite` icon), placed inside `cardOverlayButton-br`, NOT inside `cardIndicators`.

### 2f. cardFooter / cardText / cardText-secondary

Lines 802–805 (footer class chain):

```
A||k||(d=i.cardLayout?"cardFooter":"cardFooter cardFooter-transparent",
       m&&(d+=" cardFooter-withlogo"),
       i.cardLayout||(m=null),
       L=V(r,0,i,d,O,...))
```

V() (line 690 ff.) emits per-line text:

```
c+="<div class='"+m+"'>",  // m = "cardText", "cardText cardTextCentered", or with " cardText-secondary"/" cardText-first"
c+="<bdi>"+d+"</bdi>",
c+="</div>",
```

So a typical title-only outer footer is:

```html
<div class="cardFooter cardFooter-transparent">
  <div class="cardText"><bdi>Book Title</bdi></div>
  <div class="cardText cardText-secondary"><bdi>Author Name</bdi></div>
</div>
```

`cardTextCentered` is added when `centerText:true` is passed in cardOptions.

Text **lives below** the card (outside `cardScalable`) in the standard non-cardLayout case. Inner footers (`innerCardFooter` / `fullInnerCardFooter`) are only used when `overlayText:true` or there's a progress bar — in those cases it's nested inside the image container.

---

## 3. Hover overlay play button

Already covered in 2d. Confirmed:

- Class chain: `cardOverlayButton cardOverlayButton-hover itemAction paper-icon-button-light cardOverlayFab-primary`
- Icon: `<span class="material-icons cardOverlayButtonIcon cardOverlayButtonIcon-hover play_arrow" aria-hidden="true">` (codepoint mode, no ligature text)
- `is="paper-icon-button-light"` on the `<button>` (web component)
- `data-action="resume"` (or `play` for non-video / non-resume contexts)
- Hover-reveal is CSS-only via `card-hoverable` ancestor + opacity transitions

---

## 4. Item detail page chrome

Live bundle: `/web/itemDetails.a70fe65bb5872353bc5b.chunk.js` — confirms class names `itemDetailPage`, `mainDetailButtons`, `nameContainer`, `detailLogo`, `btnPlay`, `btnPlayTrailer`, `btnMoreCommands`, etc. are all referenced in querySelectors.

The HTML template itself is loaded from `controllers/itemDetails/index.html` at runtime via webpack's html-loader; the published chunk only contains the JS controller. Verified verbatim against GitHub `jellyfin/jellyfin-web@v10.11.8/src/controllers/itemDetails/index.html`:

### 4a. Page outer

```html
<div id="itemDetailPage" data-role="page" class="page libraryPage itemDetailPage noSecondaryNavPage selfBackdropPage" data-backbutton="true">
    <div id="itemBackdrop" class="itemBackdrop"></div>
    <div class="detailLogo"></div>
    <div class="detailPageWrapperContainer">
        <div class="detailPagePrimaryContainer">
            <div class="detailImageContainer hide-mobile"></div>
            <div class="detailRibbon padded-left padded-right">
                <div class="infoWrapper">
                    <div class="detailImageContainer hide-desktop hide-tv"></div>
                    <div class="nameContainer"></div>
                    <div class="itemMiscInfo itemMiscInfo-primary" style="margin-bottom: 0.6em;"></div>
                    <div class="itemMiscInfo itemMiscInfo-secondary" style="margin-bottom: 0.6em;"></div>
                </div>
                <div class="mainDetailButtons focuscontainer-x">
                  ...
                </div>
            </div>
            ...
```

### 4b. mainDetailButtons + individual detail button structure

Verbatim from the same template, lines 22–33:

```html
<button is="emby-button" type="button" class="button-flat btnPlay hide detailButton" title="${ButtonResume}" data-action="resume">
    <div class="detailButton-content">
        <span class="material-icons detailButton-icon play_arrow" aria-hidden="true"></span>
    </div>
</button>
```

So:
- The outer wrapper is `<div class="mainDetailButtons focuscontainer-x">`
- Each button is `<button is="emby-button" type="button" class="button-flat <name> hide detailButton" title="${...}">` — note **no `<div class="detailButton-text">` in 10.11.8**; only `<div class="detailButton-content">` containing a `<span class="material-icons detailButton-icon ${iconname}">`. The label is the button's `title` (tooltip), not a visible text node.
- `hide` is removed at runtime when the button is applicable; `disabled` toggled separately.

### 4c. "More like this" section

Same template, lines 257–262:

```html
<div id="similarCollapsible" class="verticalSection detailVerticalSection verticalSection-extrabottompadding hide">
    <h2 class="sectionTitle sectionTitle-cards padded-right">${HeaderMoreLikeThis}</h2>
    <div is="emby-scroller" class="padded-top-focusscale padded-bottom-focusscale no-padding" data-centerfocus="true">
        <div is="emby-itemscontainer" class="scrollSlider focuscontainer-x itemsContainer similarContent"></div>
    </div>
</div>
```

Note: detail-page rails use `<h2>` directly (no `sectionTitleContainer`), with `padded-right` instead of the home-page `padded-left`. The `emby-scroller` adds `no-padding`.

The sibling "More by author / artist" rail is `class="verticalSection detailVerticalSection moreFromArtistSection hide"` with the same structure.

---

## 5. Toast component

Pulled from GitHub `jellyfin/jellyfin-web@v10.11.8/src/components/toast/toast.ts` (the runtime toast was minified into the main bundle — the class names match what `main.css` exposes: `.toast`, `.toastContainer`, `.toastVisible`, `.toastHide`).

```ts
function getToastContainer() {
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.classList.add('toastContainer');
        document.body.appendChild(toastContainer);
    }
    return toastContainer;
}

export default function (options: string | Toast) {
    ...
    const elem = document.createElement('div');
    elem.classList.add('toast');
    elem.textContent = options.text;
    getToastContainer().appendChild(elem);
    setTimeout(function () {
        elem.classList.add('toastVisible');
        animateRemove(elem);
    }, 300);
}
```

Lifecycle:
- 300ms after `appendChild` → `toastVisible` class added (transform: none — slides up into view)
- 3300ms after that → `toastHide` class added (opacity 0)
- 300ms after that → element removed from DOM

Mount point: a singleton `<div class="toastContainer">` appended to `document.body` (lazy on first toast).

CSS class chain:
- `.toastContainer` — fixed-bottom-left container, `pointer-events: none`, `z-index: 9999999`, padding driven by safe-area insets via `conditional-max`. `[dir="ltr"] & { left: 0 }` so it sits at the bottom-left.
- `.toast` — the slide-card, `min-width: 20em`, `box-shadow`, `border-radius: 0.15em`, `padding: 1em 1.5em`, `font-size: 110%`, `pointer-events: initial`. Initially `transform: translateY(16em)` (off-screen below).
- `.toast.toastVisible` — `transform: none`
- `.toast.toastHide` — `opacity: 0`

---

## 6. Action buttons next to title (favourite, mark-watched)

These are **not** "next to the title" in 10.11.8 — they're inside `mainDetailButtons` along with Play, as `btnUserRating` and `btnPlaystate`. From the same template (lines 79–88):

```html
<button is="emby-playstatebutton" type="button" class="button-flat btnPlaystate hide detailButton" title="">
    <div class="detailButton-content">
        <span class="material-icons detailButton-icon check" aria-hidden="true"></span>
    </div>
</button>

<button is="emby-ratingbutton" type="button" class="button-flat btnUserRating hide detailButton" title="${Rate}">
    <div class="detailButton-content">
        <span class="material-icons detailButton-icon favorite" aria-hidden="true"></span>
    </div>
</button>
```

These two web components (`emby-playstatebutton`, `emby-ratingbutton`) auto-toggle the icon (filled vs outline) and the data attributes (`data-played`, `data-isfavorite`) when clicked, calling `MarkPlayed`/`MarkUnplayed` and `UpdateUserItemRating` API endpoints respectively. We should never re-implement that logic — just instantiate the web component or render the same markup and let the existing handler pick it up.

---

## Recommendations for cypherflix-hub components

### card.ts — single source of truth markup

```html
<div class="card overflowPortraitCard card-hoverable card-withuserdata"
     data-id="{ItemId}" data-serverid="{ServerId}" data-type="{Type}" data-isfolder="false"
     data-action="link">
  <div class="cardBox cardBox-bottompadded">
    <div class="cardScalable">
      <div class="cardPadder cardPadder-overflowPortrait"></div>
      <a href="#/details?id={ItemId}&serverId={ServerId}"
         class="cardImageContainer coveredImage cardContent itemAction lazy"
         data-action="link"
         data-src="{ImageUrl}"
         aria-label="{Name}" role="img"></a>
      <div class="cardOverlayContainer itemAction" data-action="link">
        <!-- queue FAB injected here at hover time, see queueFab.ts -->
      </div>
      <div class="cardIndicators">
        <!-- indicators rendered conditionally, see indicators.ts -->
      </div>
    </div>
    <div class="cardFooter cardFooter-transparent">
      <div class="cardText cardTextCentered"><bdi>{Title}</bdi></div>
      <div class="cardText cardText-secondary cardTextCentered"><bdi>{Subtitle}</bdi></div>
    </div>
  </div>
</div>
```

### carousel.ts — verticalSection wrapper

```html
<div class="verticalSection">
  <div class="sectionTitleContainer sectionTitleContainer-cards padded-left">
    <a is="emby-linkbutton" href="{seeAllUrl}" class="more button-flat button-flat-mini sectionTitleTextButton">
      <h2 class="sectionTitle sectionTitle-cards">{Title}</h2>
      <span class="material-icons chevron_right" aria-hidden="true"></span>
    </a>
  </div>
  <div is="emby-scroller" class="padded-top-focusscale padded-bottom-focusscale" data-centerfocus="true">
    <div is="emby-itemscontainer" class="itemsContainer scrollSlider focuscontainer-x">
      <!-- cards from card.ts -->
    </div>
  </div>
</div>
```

For Discover/Queue/Following rows that are not click-through, drop the `<a>` wrapper around the title:

```html
<div class="sectionTitleContainer sectionTitleContainer-cards padded-left">
  <h2 class="sectionTitle sectionTitle-cards">{Title}</h2>
</div>
```

The `is="emby-scroller"` web component automatically adds `emby-scroller-container` to its parentNode and renders the chevron arrows inside `.emby-scrollbuttons.padded-right` — we get those arrows for free as long as the upgrade-element runs (it does, on app boot).

### detailPage.ts — itemDetailPage chrome

```html
<div id="itemDetailPage" data-role="page" class="page libraryPage itemDetailPage noSecondaryNavPage selfBackdropPage" data-backbutton="true">
  <div id="itemBackdrop" class="itemBackdrop"></div>
  <div class="detailLogo"></div>
  <div class="detailPageWrapperContainer">
    <div class="detailPagePrimaryContainer">
      <div class="detailImageContainer hide-mobile"></div>
      <div class="detailRibbon padded-left padded-right">
        <div class="infoWrapper">
          <div class="detailImageContainer hide-desktop hide-tv"></div>
          <div class="nameContainer"></div>
          <div class="itemMiscInfo itemMiscInfo-primary"></div>
          <div class="itemMiscInfo itemMiscInfo-secondary"></div>
        </div>
        <div class="mainDetailButtons focuscontainer-x">
          <button is="emby-button" type="button" class="button-flat btnQueue detailButton" title="Add to Queue" data-action="queue">
            <div class="detailButton-content">
              <span class="material-icons detailButton-icon queue" aria-hidden="true"></span>
            </div>
          </button>
          <button is="emby-button" type="button" class="button-flat btnFollow detailButton" title="Follow" data-action="follow">
            <div class="detailButton-content">
              <span class="material-icons detailButton-icon notifications" aria-hidden="true"></span>
            </div>
          </button>
          <!-- additional cypherflix buttons follow same pattern -->
        </div>
      </div>
      <div class="detailPagePrimaryContent padded-right">
        <div class="detailSection">
          <div class="detailSectionContent">
            <p class="overview"></p>
          </div>
        </div>
      </div>
    </div>
    <div class="detailPageSecondaryContainer padded-bottom-page">
      <div class="detailPageContent">
        <div class="verticalSection detailVerticalSection moreFromAuthorSection hide">
          <h2 class="sectionTitle sectionTitle-cards padded-right">More by {Author}</h2>
          <div is="emby-scroller" class="padded-top-focusscale padded-bottom-focusscale no-padding" data-centerfocus="true">
            <div is="emby-itemscontainer" class="scrollSlider focuscontainer-x itemsContainer"></div>
          </div>
        </div>
        <div id="similarCollapsible" class="verticalSection detailVerticalSection verticalSection-extrabottompadding hide">
          <h2 class="sectionTitle sectionTitle-cards padded-right">More like this</h2>
          <div is="emby-scroller" class="padded-top-focusscale padded-bottom-focusscale no-padding" data-centerfocus="true">
            <div is="emby-itemscontainer" class="scrollSlider focuscontainer-x itemsContainer similarContent"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
```

### queueFab.ts — hover overlay button

Inject inside `.cardOverlayContainer` of an existing card (native or our own):

```html
<button is="paper-icon-button-light"
        class="cardOverlayButton cardOverlayButton-hover itemAction paper-icon-button-light cardOverlayFab-primary"
        data-action="queue" title="Add to Queue">
  <span class="material-icons cardOverlayButtonIcon cardOverlayButtonIcon-hover queue" aria-hidden="true"></span>
</button>
```

For queue-already-in-queue state, swap the icon class from `queue` to `playlist_add_check` and add a `disabled` attribute (the `cardOverlayButton-hover` opacity transitions still apply).

### indicators.ts — cardIndicators

Append to `.cardIndicators` (create if missing as a child of `.cardImageContainer`):

```html
<div class="cardIndicators">
  <div class="followingIndicator indicator">
    <span class="material-icons indicatorIcon notifications_active" aria-hidden="true"></span>
  </div>
  <div class="queuedIndicator indicator">
    <span class="material-icons indicatorIcon playlist_add_check" aria-hidden="true"></span>
  </div>
</div>
```

(Indicator class chain `<x>Indicator indicator` matches Jellyfin's `playedIndicator indicator`, `mediaSourceIndicator`, `timerIndicator` etc.)

### toast.ts — snackbar markup

Singleton container appended to `document.body` once:

```html
<div class="toastContainer"></div>
```

Per toast, append:

```html
<div class="toast">{Text}</div>
```

Lifecycle (verbatim from the v10.11.8 toast.ts):
- mount → 300ms wait → add `toastVisible` (slide up into view)
- 3300ms after that → add `toastHide` (fade)
- 300ms after that → remove from DOM

`textContent` (not `innerHTML`) for the body, to avoid HTML injection.

---

## Class-chain claims from the previous architecture doc that turned out to be wrong

| Old claim | Correct |
|---|---|
| `.verticalSection.emby-scroller-container` is the outer wrapper | The `verticalSection` and the scroller-container are **separate elements**. `verticalSection` is the outer; `emby-scroller-container` is auto-added by the web component to the **parentNode of `emby-scroller`**, which in our markup ends up being `verticalSection` itself only because `emby-scroller` is the direct child. Don't author it manually — let the upgrade-element add it. |
| Title element is always `.sectionTitleContainer.padded-left > h2` | True for **LatestMedia** rails and library "see all" rails. **False** for Resume/NextUp/SmallLibraryTiles — those use a bare `<h2 class="sectionTitle sectionTitle-cards padded-left">` with no container. Detail-page rails use `<h2 class="sectionTitle sectionTitle-cards padded-right">` (different padding side, no container). |
| Detail-page section padding is `padded-left padded-right` | Detail-page rails use **`padded-right` only** on the `<h2>`, and the `<emby-scroller>` adds `no-padding` (overriding the default focusscale paddings). Home-page rails use `padded-left` on the title container. |
| `.detailButton` has a `<div class="detailButton-text">` for the label | False in 10.11.8. Only `<div class="detailButton-content">` containing the icon span. The label is in the button's `title` attribute (tooltip). |
| `.mainDetailButtons` is named `.detailButtons` | Correct as `.mainDetailButtons` (the user's instruction was right; keeping for clarity). The container also has `focuscontainer-x`. |
| Card overlay icon uses ligature text (`<span>play_arrow</span>` with text body) | False. Codepoint mode: `<span class="material-icons play_arrow" aria-hidden="true"></span>` — no text content. Jellyfin's font-loader maps the class to the codepoint. |
| Card hover uses JS class toggling | False. Pure CSS opacity transitions, gated by `card-hoverable` on the outer card. The buttons are in the DOM at all times. |
| Played-tick lives inside the cardOverlayButton-br | False. It's inside `.cardIndicators` (a sibling of `.cardImageContainer`/`.cardScalable`). The cardOverlayButton-br hosts the *toggleable* favourite/menu/mark-played buttons (not visible without hover). |
| Image is set via `<img src="">` inside `.cardImageContainer` | False. `data-src="..."` on the `.cardImageContainer` element itself; the lazy loader sets `background-image` once in viewport. The `.cardImageContainer` toggles class `lazy` while pending. |
| Card outer wrapper is always `<div>` | False. Desktop = `<a href="#/details?id=...">`, TV = `<div>`. Both have `data-action="link"` (or whatever the configured default action is). |
| Toast mounts inside the page container | False. Singleton `.toastContainer` appended to `document.body`. |
| Toast lifecycle is 2s | False. 300ms in, 3300ms visible, 300ms fade, then remove. Total ~3.9s. |
