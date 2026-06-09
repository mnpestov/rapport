import fs from 'fs';
import https from 'https';

const token = process.env.FIGMA_TOKEN || '';
const fileId = 'aoLMlIOmSFLpR3RXMJMukx';

const options = {
  hostname: 'api.figma.com',
  path: `/v1/files/${fileId}`,
  method: 'GET',
  headers: {
    'X-Figma-Token': token
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    fs.writeFileSync('figma_data.json', data);
    console.log('Saved to figma_data.json');
  });
});

req.on('error', (error) => {
  console.error(error);
});

req.end();
