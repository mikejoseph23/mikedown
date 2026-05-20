/**
 * Emoji picker modal — searchable grid with category sections.
 *
 * Opened by the toolbar Emoji button, right-click "Insert Emoji…", and
 * Cmd+; / Ctrl+;. Inserts the chosen emoji as the existing Emoji node at the
 * cursor so the markdown round-trip keeps `:shortcode:` form on save.
 *
 * Categories are hand-curated to keep the bundle small — for matches outside
 * the curated set, the search box queries the full `markdown-it-emoji` map.
 */

import { Editor } from '@tiptap/core';
import emojiData from 'markdown-it-emoji/lib/data/full.mjs';

const EMOJI_MAP = emojiData as Record<string, string>;
const ALL_KEYS = Object.keys(EMOJI_MAP);

const RECENTS_KEY = 'mikedown.emojiPicker.recents';
const MAX_RECENTS = 16;

interface Category {
  label: string;
  codes: string[];
}

// Curated category lists — small enough to keep the bundle compact while
// covering the emoji writers actually reach for. Search falls back to the
// full markdown-it-emoji map for anything outside this set.
const CATEGORIES: Category[] = [
  {
    label: 'Smileys',
    codes: [
      'grinning', 'smiley', 'smile', 'grin', 'laughing', 'sweat_smile',
      'rofl', 'joy', 'slightly_smiling_face', 'upside_down_face',
      'wink', 'blush', 'innocent', 'smiling_face_with_three_hearts',
      'heart_eyes', 'star_struck', 'kissing_heart', 'kissing',
      'yum', 'stuck_out_tongue', 'stuck_out_tongue_winking_eye',
      'zany_face', 'face_with_raised_eyebrow', 'neutral_face',
      'expressionless', 'no_mouth', 'smirk', 'unamused', 'roll_eyes',
      'thinking', 'face_with_hand_over_mouth', 'shushing_face',
      'lying_face', 'face_with_symbols_over_mouth', 'pensive',
      'confused', 'slightly_frowning_face', 'worried', 'cry',
      'sob', 'scream', 'cold_sweat', 'sweat', 'tired_face', 'weary',
      'rage', 'triumph', 'sleepy', 'sleeping', 'yawning_face', 'mask',
      'sunglasses', 'nerd_face', 'monocle_face',
    ],
  },
  {
    label: 'People',
    codes: [
      'wave', 'raised_back_of_hand', 'raised_hand', 'vulcan_salute',
      'ok_hand', 'pinching_hand', 'v', 'crossed_fingers', 'love_you_gesture',
      'metal', 'call_me_hand', 'point_left', 'point_right', 'point_up_2',
      'point_down', '+1', '-1', 'fist', 'punch', 'fist_left', 'fist_right',
      'clap', 'raised_hands', 'open_hands', 'pray', 'handshake', 'muscle',
      'eyes', 'eye', 'tongue', 'lips', 'baby', 'boy', 'girl', 'woman',
      'man', 'older_woman', 'older_man',
    ],
  },
  {
    label: 'Animals & Nature',
    codes: [
      'dog', 'cat', 'mouse', 'hamster', 'rabbit', 'fox_face', 'bear',
      'panda_face', 'koala', 'tiger', 'lion', 'cow', 'pig', 'pig_nose',
      'frog', 'monkey_face', 'see_no_evil', 'hear_no_evil', 'speak_no_evil',
      'monkey', 'chicken', 'penguin', 'bird', 'baby_chick', 'duck',
      'eagle', 'owl', 'bat', 'wolf', 'boar', 'horse', 'unicorn', 'bee',
      'bug', 'butterfly', 'snail', 'lady_beetle', 'ant', 'spider',
      'scorpion', 'turtle', 'snake', 'lizard', 'dolphin', 'whale',
      'shark', 'octopus', 'fish', 'tropical_fish', 'crab', 'shrimp',
      'crocodile', 'leopard', 'zebra', 'gorilla', 'cherry_blossom',
      'rose', 'sunflower', 'tulip', 'seedling', 'evergreen_tree',
      'palm_tree', 'cactus', 'mushroom',
    ],
  },
  {
    label: 'Food & Drink',
    codes: [
      'green_apple', 'apple', 'pear', 'tangerine', 'lemon', 'banana',
      'watermelon', 'grapes', 'strawberry', 'melon', 'cherries', 'peach',
      'pineapple', 'tomato', 'eggplant', 'avocado', 'broccoli', 'corn',
      'hot_pepper', 'cucumber', 'carrot', 'potato', 'sweet_potato',
      'bread', 'croissant', 'pretzel', 'cheese', 'egg', 'bacon',
      'hamburger', 'fries', 'pizza', 'hotdog', 'sandwich', 'taco',
      'burrito', 'salad', 'spaghetti', 'ramen', 'curry', 'sushi',
      'rice', 'bento', 'cake', 'birthday', 'cookie', 'chocolate_bar',
      'candy', 'lollipop', 'honey_pot', 'ice_cream', 'doughnut',
      'coffee', 'tea', 'sake', 'beer', 'beers', 'wine_glass',
      'cocktail', 'tropical_drink', 'champagne',
    ],
  },
  {
    label: 'Activity',
    codes: [
      'soccer', 'basketball', 'football', 'baseball', 'tennis', 'volleyball',
      'rugby_football', '8ball', 'ping_pong', 'badminton', 'hockey',
      'field_hockey', 'cricket_bat_and_ball', 'golf', 'archery_bow_and_arrow',
      'fishing_pole_and_fish', 'boxing_glove', 'ski', 'snowboarder',
      'surfer', 'swimmer', 'rowboat', 'horse_racing', 'bicyclist',
      'mountain_bicyclist', 'trophy', 'medal', '1st_place_medal',
      '2nd_place_medal', '3rd_place_medal', 'guitar', 'musical_keyboard',
      'drum_with_drumsticks', 'video_game', 'dart', 'game_die', 'chess_pawn',
    ],
  },
  {
    label: 'Travel & Places',
    codes: [
      'car', 'taxi', 'blue_car', 'bus', 'trolleybus', 'racing_car',
      'police_car', 'ambulance', 'fire_engine', 'minibus', 'truck',
      'articulated_lorry', 'tractor', 'motor_scooter', 'bike', 'scooter',
      'airplane', 'helicopter', 'rocket', 'flying_saucer', 'boat',
      'ship', 'speedboat', 'ferry', 'sailboat', 'anchor', 'station',
      'train', 'bullettrain_side', 'mountain_railway',
      'house', 'office', 'school', 'hospital', 'bank', 'hotel',
      'convenience_store', 'department_store', 'factory', 'european_castle',
      'japanese_castle', 'statue_of_liberty', 'tokyo_tower',
      'fountain', 'tent', 'foggy', 'sunrise', 'sunrise_over_mountains',
      'city_sunset', 'cityscape', 'night_with_stars', 'milky_way',
    ],
  },
  {
    label: 'Objects',
    codes: [
      'computer', 'desktop_computer', 'printer', 'keyboard', 'computer_mouse',
      'iphone', 'calling', 'phone', 'pager', 'fax', 'tv', 'camera',
      'video_camera', 'movie_camera', 'film_projector', 'film_strip',
      'clapper', 'cd', 'dvd', 'minidisc', 'floppy_disk', 'vhs', 'satellite',
      'battery', 'electric_plug', 'mag', 'mag_right', 'bulb', 'flashlight',
      'candle', 'gear', 'wrench', 'hammer', 'hammer_and_wrench', 'pick',
      'nut_and_bolt', 'gun', 'bomb', 'firecracker', 'knife', 'shield',
      'package', 'envelope', 'incoming_envelope', 'love_letter', 'inbox_tray',
      'outbox_tray', 'mailbox', 'newspaper', 'memo', 'pencil2',
      'lock', 'unlock', 'key', 'closed_lock_with_key', 'bookmark',
      'label', 'pushpin', 'paperclip', 'paperclips',
    ],
  },
  {
    label: 'Symbols',
    codes: [
      'heart', 'orange_heart', 'yellow_heart', 'green_heart', 'blue_heart',
      'purple_heart', 'black_heart', 'broken_heart', 'two_hearts',
      'sparkling_heart', 'cupid', 'gift_heart', 'heart_decoration',
      'peace_symbol', 'cross', 'star_and_crescent', 'om', 'wheel_of_dharma',
      'star_of_david', 'six_pointed_star', 'menorah_with_nine_branches',
      'yin_yang', 'orthodox_cross', 'place_of_worship',
      'warning', 'no_entry', 'no_entry_sign', 'name_badge', 'no_smoking',
      'do_not_litter', 'non-potable_water', 'no_bicycles', 'no_pedestrians',
      'children_crossing', 'mens', 'womens', 'restroom', 'baby_symbol',
      'wc', 'passport_control', 'customs', 'baggage_claim', 'left_luggage',
      'arrow_left', 'arrow_right', 'arrow_up', 'arrow_down',
      'arrow_upper_left', 'arrow_upper_right', 'arrow_lower_left',
      'arrow_lower_right', 'leftwards_arrow_with_hook', 'arrow_right_hook',
      'arrow_heading_up', 'arrow_heading_down', 'arrows_counterclockwise',
      'arrows_clockwise', 'back', 'end', 'on', 'soon', 'top',
      'white_check_mark', 'ballot_box_with_check', 'heavy_check_mark',
      'x', 'negative_squared_cross_mark', 'heavy_plus_sign', 'heavy_minus_sign',
      'heavy_division_sign', 'heavy_multiplication_x', 'question',
      'grey_question', 'grey_exclamation', 'exclamation', 'heavy_exclamation_mark',
      'wavy_dash', 'curly_loop', 'loop', 'part_alternation_mark',
      'asterisk', 'zero', 'one', 'two', 'three', 'four', 'five',
      'six', 'seven', 'eight', 'nine', 'keycap_ten',
      '100', 'fire', 'sparkles', 'star', 'star2', 'dizzy', 'boom',
      'collision', 'anger', 'sweat_drops', 'dash', 'zzz',
    ],
  },
];

let pickerEl: HTMLElement | null = null;
let openEditor: Editor | null = null;

function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s: any): s is string => typeof s === 'string' && s in EMOJI_MAP).slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

function saveRecent(shortcode: string): void {
  try {
    const current = loadRecents().filter((s) => s !== shortcode);
    current.unshift(shortcode);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(current.slice(0, MAX_RECENTS)));
  } catch {
    // localStorage may throw inside webview sandbox in rare cases — non-fatal.
  }
}

function insertEmoji(shortcode: string): void {
  if (!openEditor) return;
  const emojiType = openEditor.schema.nodes.emoji;
  if (emojiType) {
    openEditor.chain().focus().insertContent({ type: 'emoji', attrs: { shortcode } }).run();
  } else {
    const char = EMOJI_MAP[shortcode] || `:${shortcode}:`;
    openEditor.chain().focus().insertContent(char).run();
  }
  saveRecent(shortcode);
}

export function hideEmojiPicker(): void {
  if (pickerEl) {
    pickerEl.remove();
    pickerEl = null;
  }
  openEditor = null;
  document.removeEventListener('mousedown', onDocMouseDown, true);
}

function onDocMouseDown(e: MouseEvent): void {
  if (!pickerEl) return;
  if (!(e.target as HTMLElement).closest('#mikedown-emoji-picker')) {
    hideEmojiPicker();
  }
}

export function isEmojiPickerOpen(): boolean {
  return pickerEl !== null;
}

interface ShowOptions {
  anchorRect?: DOMRect;
  point?: { x: number; y: number };
}

export function showEmojiPicker(editor: Editor, opts: ShowOptions = {}): void {
  hideEmojiPicker();
  openEditor = editor;

  pickerEl = document.createElement('div');
  pickerEl.id = 'mikedown-emoji-picker';
  pickerEl.setAttribute('role', 'dialog');

  const searchWrap = document.createElement('div');
  searchWrap.className = 'emoji-picker-search';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Search emoji…';
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'Search emoji');
  searchWrap.appendChild(input);
  pickerEl.appendChild(searchWrap);

  const grid = document.createElement('div');
  grid.className = 'emoji-picker-grid';
  pickerEl.appendChild(grid);

  let cells: HTMLButtonElement[] = [];
  let activeIndex = 0;

  const setActive = (i: number): void => {
    if (cells.length === 0) return;
    const clamped = Math.max(0, Math.min(i, cells.length - 1));
    cells.forEach((c, idx) => c.classList.toggle('emoji-picker-active', idx === clamped));
    cells[clamped].scrollIntoView({ block: 'nearest' });
    activeIndex = clamped;
  };

  const buildCell = (shortcode: string): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'emoji-picker-cell';
    btn.title = `:${shortcode}:`;
    btn.textContent = EMOJI_MAP[shortcode] || `:${shortcode}:`;
    btn.dataset.shortcode = shortcode;
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      insertEmoji(shortcode);
      hideEmojiPicker();
    });
    btn.addEventListener('mouseenter', () => setActive(cells.indexOf(btn)));
    return btn;
  };

  const appendSection = (label: string, codes: string[]): void => {
    if (codes.length === 0) return;
    const header = document.createElement('div');
    header.className = 'emoji-picker-section-header';
    header.textContent = label;
    grid.appendChild(header);
    const row = document.createElement('div');
    row.className = 'emoji-picker-row';
    for (const code of codes) {
      if (!(code in EMOJI_MAP)) continue;
      const cell = buildCell(code);
      row.appendChild(cell);
      cells.push(cell);
    }
    grid.appendChild(row);
  };

  const render = (filter: string): void => {
    grid.innerHTML = '';
    cells = [];
    const q = filter.trim().toLowerCase();

    if (!q) {
      const recents = loadRecents();
      if (recents.length > 0) appendSection('Recent', recents);
      for (const cat of CATEGORIES) {
        const filtered = cat.codes.filter((c) => c in EMOJI_MAP);
        appendSection(cat.label, filtered);
      }
    } else {
      const matches: string[] = [];
      const starts: string[] = [];
      const contains: string[] = [];
      for (const key of ALL_KEYS) {
        if (key === q) {
          matches.push(key);
        } else if (key.startsWith(q)) {
          starts.push(key);
        } else if (key.includes(q)) {
          contains.push(key);
        }
      }
      const combined = [...matches, ...starts, ...contains].slice(0, 64);
      if (combined.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'emoji-picker-empty';
        empty.textContent = 'No emoji match';
        grid.appendChild(empty);
        return;
      }
      appendSection('Results', combined);
    }

    if (cells.length > 0) setActive(0);
  };

  input.addEventListener('input', () => render(input.value));
  input.addEventListener('keydown', (e) => {
    if (cells.length === 0 && e.key !== 'Escape') return;
    const cols = 8;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setActive(activeIndex + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setActive(activeIndex - 1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(activeIndex + cols);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(activeIndex - cols);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cell = cells[activeIndex];
      if (cell?.dataset.shortcode) {
        insertEmoji(cell.dataset.shortcode);
        hideEmojiPicker();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      hideEmojiPicker();
      editor.commands.focus();
    }
  });

  document.body.appendChild(pickerEl);
  render('');

  // Position — match languagepicker.ts logic.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  pickerEl.style.visibility = 'hidden';
  const rect = pickerEl.getBoundingClientRect();
  let left: number;
  let top: number;
  if (opts.anchorRect) {
    left = opts.anchorRect.right - rect.width;
    top = opts.anchorRect.bottom + 4;
    if (top + rect.height > vh - 4) {
      top = opts.anchorRect.top - rect.height - 4;
    }
  } else if (opts.point) {
    left = opts.point.x;
    top = opts.point.y;
  } else {
    left = (vw - rect.width) / 2;
    top = (vh - rect.height) / 2;
  }
  left = Math.max(4, Math.min(left, vw - rect.width - 4));
  top = Math.max(4, Math.min(top, vh - rect.height - 4));
  pickerEl.style.left = `${left}px`;
  pickerEl.style.top = `${top}px`;
  pickerEl.style.visibility = '';

  requestAnimationFrame(() => {
    document.addEventListener('mousedown', onDocMouseDown, true);
  });

  input.focus();
}
