import { prisma } from '../src/prismaClient';
import { generateSlug } from '../src/utils/slug';

async function main() {
  console.log('Starting seeding...');
  
  await prisma.pattern.deleteMany();

  const patterns = [
      {
        title: "#ruffle_collar",
        author: "bot",
        imageUrl: "http://localhost:3000/images/%23ruffle_collar.png",
        isFree: true,
        primaryProductType: "Воротник",
        instruments: ["Спицы"],
      },
      {
        title: "Берет",
        author: "bot",
        imageUrl: "http://localhost:3000/images/%D0%91%D0%B5%D1%80%D0%B5%D1%82.png",
        isFree: true,
        primaryProductType: "Головной убор",
        instruments: ["Спицы"],
      },
      {
        title: "#сумка_кругивквадрате",
        author: "bot",
        imageUrl: "http://localhost:3000/images/%23%D1%81%D1%83%D0%BC%D0%BA%D0%B0_%D0%BA%D1%80%D1%83%D0%B3%D0%B8%D0%B2%D0%BA%D0%B2%D0%B0%D0%B4%D1%80%D0%B0%D1%82%D0%B5.png",
        isFree: true,
        primaryProductType: "Сумка",
        instruments: ["Крючок"],
      },
      {
        title: "#spiraeaflowers_vest",
        author: "bot",
        imageUrl: "http://localhost:3000/images/%23spiraeaflowers_vest.png",
        isFree: true,
        primaryProductType: "Жилет",
        instruments: ["Крючок"],
      },
      {
        title: "#kiset_pouch",
        author: "bot",
        imageUrl: "http://localhost:3000/images/%23kiset_pouch.png",
        isFree: true,
        primaryProductType: "Сумочка",
        instruments: ["Крючок"],
      },
      {
        title: "#Emily_Sweater",
        author: "bot",
        imageUrl: "https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=500&q=80",
        isFree: true,
        primaryProductType: "Свитер",
        instruments: ["Спицы"],
      },
      {
        title: "#ivory_muse_top",
        author: "bot",
        imageUrl: "https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?w=500&q=80",
        isFree: true,
        primaryProductType: "Топ",
        instruments: ["Спицы"],
      },
      {
        title: "#scandic_scarf",
        author: "bot",
        imageUrl: "https://images.unsplash.com/photo-1520903920243-00d872a2d1c9?w=500&q=80",
        isFree: true,
        primaryProductType: "Шарф",
        instruments: ["Спицы"],
      },
      {
        title: "Платье Карелия",
        author: "bot",
        imageUrl: "https://images.unsplash.com/photo-1515347619111-ea9dbf07e5f3?w=500&q=80",
        isFree: true,
        primaryProductType: "Платье",
        instruments: ["Спицы"],
      },
      {
        title: "dreams _ jumper",
        author: "bot",
        imageUrl: "https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=500&q=80",
        isFree: true,
        primaryProductType: "Джемпер",
        instruments: ["Спицы"],
      },
      {
        title: "Кардиган «Вайя»",
        author: "bot",
        imageUrl: "https://images.unsplash.com/photo-1608228079968-c76819ba9708?w=500&q=80",
        isFree: true,
        primaryProductType: "Кардиган",
        instruments: ["Спицы"],
      },
      {
        title: "#Lazy_daisy_hat",
        author: "bot",
        imageUrl: "https://images.unsplash.com/photo-1576871337622-98d48d1cf531?w=500&q=80",
        isFree: true,
        primaryProductType: "Головной убор",
        instruments: ["Спицы"],
      },
      {
        title: "#bayuma_trio",
        author: "bot",
        imageUrl: "https://images.unsplash.com/photo-1620799140188-3b2a02fd9a77?w=500&q=80",
        isFree: true,
        primaryProductType: "Комплект",
        instruments: ["Спицы"],
      },
      {
        title: "warm _ hat",
        author: "bot",
        imageUrl: "https://images.unsplash.com/photo-1576871337622-98d48d1cf531?w=500&q=80",
        isFree: true,
        primaryProductType: "Головной убор",
        instruments: ["Спицы"],
      },
      {
        title: "#пушистая_ушанка",
        author: "bot",
        imageUrl: "https://images.unsplash.com/photo-1556306535-38febf6782e7?w=500&q=80",
        isFree: true,
        primaryProductType: "Головной убор",
        instruments: ["Спицы"],
      }
  ];

  for (const p of patterns) {
    const slug = generateSlug(p.title);
    
    const author = await prisma.author.upsert({
      where: { name: p.author },
      update: {},
      create: { name: p.author }
    });

    await prisma.pattern.create({
      data: {
        title: p.title,
        slug: slug,
        url: `https://rapport.su/patterns/${slug}`,
        imageUrl: p.imageUrl,
        isFree: p.isFree,
        authorId: author.id,
        categories: {
          connectOrCreate: {
            where: { name: p.primaryProductType },
            create: { name: p.primaryProductType }
          }
        },
        instruments: {
          connectOrCreate: p.instruments.map(inst => ({
            where: { name: inst },
            create: { name: inst }
          }))
        }
      }
    });
  }
  
  console.log('Seeding finished.');
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
