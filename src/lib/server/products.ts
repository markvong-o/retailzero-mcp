export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  description: string;
  rating: number;
  reviews: number;
  in_stock: boolean;
  /** Absolute URL to the product image, served from /public/products. */
  image_url: string;
}

const BASE_URL = process.env.APP_BASE_URL || "http://localhost:3000";

function productImage(id: string): string {
  return `${BASE_URL}/products/${id}.jpg`;
}

export const WISHLISTS = new Map<string, string[]>([
  [
    "alex@example.com",
    ["scarf_cashmere_001", "jacket_denim_001", "bag_weekender_001", "watch_meridian_001"],
  ],
]);

export const PREFERENCES = new Map<string, string[]>([
  ["alex@example.com", ["minimalist style", "neutral tones", "premium materials"]],
]);

export const PRODUCTS: Product[] = [
  {
    id: "scarf_cashmere_001",
    name: "Cashmere Wrap Scarf",
    price: 189.0,
    category: "accessories",
    description: "Ultra-soft cashmere wrap in a neutral palette. Perfect for layering.",
    rating: 4.6,
    reviews: 128,
    in_stock: true,
    image_url: productImage("scarf_cashmere_001"),
  },
  {
    id: "jacket_denim_001",
    name: "Blue Denim Jacket (Limited Edition)",
    price: 79.99,
    category: "outerwear",
    description: "Classic denim jacket with a modern fit. Limited run of 500.",
    rating: 4.4,
    reviews: 203,
    in_stock: true,
    image_url: productImage("jacket_denim_001"),
  },
  {
    id: "bag_weekender_001",
    name: "Leather Weekender Bag",
    price: 425.0,
    category: "bags",
    description: "Full-grain leather weekender with brass hardware. Built to last.",
    rating: 4.9,
    reviews: 67,
    in_stock: true,
    image_url: productImage("bag_weekender_001"),
  },
  {
    id: "bag_city_001",
    name: "City Tote",
    price: 199.0,
    category: "bags",
    description: "Structured leather tote for everyday carry. Laptop-friendly.",
    rating: 4.5,
    reviews: 156,
    in_stock: true,
    image_url: productImage("bag_city_001"),
  },
  {
    id: "bag_satchel_001",
    name: "Compact Travel Satchel",
    price: 149.0,
    category: "bags",
    description: "Lightweight crossbody satchel in vegetable-tanned leather.",
    rating: 4.8,
    reviews: 72,
    in_stock: true,
    image_url: productImage("bag_satchel_001"),
  },
  {
    id: "bag_heritage_001",
    name: "Heritage Duffle",
    price: 269.0,
    category: "bags",
    description: "Canvas and leather duffle bag. Classic design meets modern durability.",
    rating: 4.7,
    reviews: 93,
    in_stock: true,
    image_url: productImage("bag_heritage_001"),
  },
  {
    id: "watch_meridian_001",
    name: "Meridian Automatic Watch",
    price: 2400.0,
    category: "watches",
    description: "Swiss automatic movement with sapphire crystal. 42mm case.",
    rating: 4.9,
    reviews: 31,
    in_stock: true,
    image_url: productImage("watch_meridian_001"),
  },
  {
    id: "blazer_silk_001",
    name: "Silk Blend Blazer",
    price: 299.0,
    category: "outerwear",
    description: "Unstructured blazer in silk-wool blend. Effortlessly elegant.",
    rating: 4.3,
    reviews: 88,
    in_stock: true,
    image_url: productImage("blazer_silk_001"),
  },
  {
    id: "sneakers_canvas_001",
    name: "Canvas Sneakers",
    price: 89.0,
    category: "footwear",
    description: "Minimalist canvas sneakers with rubber sole. White and navy.",
    rating: 4.2,
    reviews: 312,
    in_stock: true,
    image_url: productImage("sneakers_canvas_001"),
  },
  {
    id: "shirt_linen_001",
    name: "Linen Shirt Set",
    price: 145.0,
    category: "tops",
    description: "Relaxed-fit linen shirt. Pre-washed for softness.",
    rating: 4.6,
    reviews: 95,
    in_stock: true,
    image_url: productImage("shirt_linen_001"),
  },
];
