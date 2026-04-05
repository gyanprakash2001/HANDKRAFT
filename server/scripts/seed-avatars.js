const https = require('https');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'uploads', 'avatars');
const COUNT = 29; // we'll fetch 29 images (plus one default will be generated)

async function download(url, dest) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // follow redirect
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`Failed to download ${url} - ${res.statusCode}`));
      const fileStream = fs.createWriteStream(dest);
      res.pipe(fileStream);
      fileStream.on('finish', () => fileStream.close(resolve));
      fileStream.on('error', (err) => reject(err));
    });
    req.on('error', reject);
  });
}

(async function seed() {
  try {
    await fs.promises.mkdir(OUT_DIR, { recursive: true });

    const tasks = [];
    for (let i = 1; i <= COUNT; i++) {
      const sig = i;
      const url = `https://source.unsplash.com/random/400x400?portrait,person,artisan,handmade&sig=${sig}`;
      const filename = `avatar${String(i + 2).padStart(2, '0')}.jpg`; // start at avatar02.jpg to leave avatar01 for default
      const dest = path.join(OUT_DIR, filename);
      tasks.push(download(url, dest).then(() => console.log('Downloaded', filename)).catch((e) => console.error('Failed', filename, e.message)));
    }

    // Optionally write a small placeholder avatar01 if not exists
    const placeholderPath = path.join(OUT_DIR, 'avatar01.jpg');
    if (!fs.existsSync(placeholderPath)) {
      // create a tiny single-pixel JPEG using a base64 string
      const base64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBUQEA8QEA8QEA8PDxAPDxAQEA8QFREWFhURFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMsNygtLisBCgoKDg0OGxAQGzclHyYtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAKgBLAMBIgACEQEDEQH/xAAbAAEAAgMBAQAAAAAAAAAAAAAABQYBAgMBB//EADMQAAIBAgQDBgQHAAAAAAAAAAECAwQRAAUSIRMxQVEGImFxcaEyQpGhscHR8f/EABgBAQEBAQEAAAAAAAAAAAAAAAABAgME/8QAHhEBAQEBAQEAAwAAAAAAAAAAAAERAhIhMUFREkH/2gAMAwEAAhEDEQA/AN6gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/2Q==';
      fs.writeFileSync(placeholderPath, Buffer.from(base64, 'base64'));
      console.log('Wrote placeholder avatar01.jpg');
    }

    await Promise.all(tasks);
    console.log('Avatar seed complete.');
  } catch (err) {
    console.error('Seeding avatars failed', err);
    process.exit(1);
  }
})();
