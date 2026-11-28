UPDATE `StorefrontContentConfig`
SET `footerDescription` = ''
WHERE `footerDescription` IN (
    'At Aashrit Corner, we redefine everyday fashion with a focus on refined structure, confident silhouettes, and long-wearing essentials. Each piece is designed to move seamlessly from daily life to elevated moments, helping you feel polished, comfortable, and effortlessly styled.',
    'At Aama Collections, we redefine everyday fashion with a focus on refined structure, confident silhouettes, and long-wearing essentials. Each piece is designed to move seamlessly from daily life to elevated moments, helping you feel polished, comfortable, and effortlessly styled.'
);

UPDATE `StorefrontContentConfig`
SET `aboutPage` = JSON_SET(`aboutPage`, '$.description', '')
WHERE JSON_UNQUOTE(JSON_EXTRACT(`aboutPage`, '$.description')) =
    'Aashrit Corner was born out of a passion for innovation and a desire to revolutionize the way people shop online. Our journey began with a simple idea: to provide a platform where customers can easily discover, explore, and purchase a wide range of products from the comfort of their homes.\n\nSince our inception, we''ve worked tirelessly to curate a diverse selection of high-quality products that cater to every taste and preference. From fashion and beauty to home essentials, we offer an extensive collection sourced from trusted brands and suppliers.';

UPDATE `StorefrontContentConfig`
SET `aboutPage` = JSON_SET(`aboutPage`, '$.missionDescription', '')
WHERE JSON_UNQUOTE(JSON_EXTRACT(`aboutPage`, '$.missionDescription')) =
    'Our mission at Aashrit Corner is to empower customers with choice, convenience, and confidence. We''re dedicated to providing a seamless shopping experience that exceeds expectations, from browsing and ordering to delivery and beyond.';

UPDATE `StorefrontContentConfig`
SET `aboutPage` = JSON_SET(`aboutPage`, '$.whyCards[0].description', '')
WHERE JSON_UNQUOTE(JSON_EXTRACT(`aboutPage`, '$.whyCards[0].description')) =
    'We meticulously select and vet each product to ensure it meets our stringent quality standards.';

UPDATE `StorefrontContentConfig`
SET `aboutPage` = JSON_SET(`aboutPage`, '$.whyCards[1].description', '')
WHERE JSON_UNQUOTE(JSON_EXTRACT(`aboutPage`, '$.whyCards[1].description')) =
    'With our user-friendly interface and hassle-free ordering process, shopping has never been easier.';

UPDATE `StorefrontContentConfig`
SET `aboutPage` = JSON_SET(`aboutPage`, '$.whyCards[2].description', '')
WHERE JSON_UNQUOTE(JSON_EXTRACT(`aboutPage`, '$.whyCards[2].description')) =
    'Our team of dedicated professionals is here to assist you, ensuring your satisfaction is our top priority.';

UPDATE `StorefrontContentConfig`
SET `benefits` = JSON_SET(`benefits`, '$[0].title', '')
WHERE JSON_UNQUOTE(JSON_EXTRACT(`benefits`, '$[0].title')) = 'Easy Exchange Policy';

UPDATE `StorefrontContentConfig`
SET `benefits` = JSON_SET(`benefits`, '$[0].description', '')
WHERE JSON_UNQUOTE(JSON_EXTRACT(`benefits`, '$[0].description')) = 'We offer hassle free exchange policy';

UPDATE `StorefrontContentConfig`
SET `benefits` = JSON_SET(`benefits`, '$[1].title', '')
WHERE JSON_UNQUOTE(JSON_EXTRACT(`benefits`, '$[1].title')) = '7 Days Return Policy';

UPDATE `StorefrontContentConfig`
SET `benefits` = JSON_SET(`benefits`, '$[1].description', '')
WHERE JSON_UNQUOTE(JSON_EXTRACT(`benefits`, '$[1].description')) = 'We provide 7 days free return policy';

UPDATE `StorefrontContentConfig`
SET `benefits` = JSON_SET(`benefits`, '$[2].title', '')
WHERE JSON_UNQUOTE(JSON_EXTRACT(`benefits`, '$[2].title')) = 'Best customer support';

UPDATE `StorefrontContentConfig`
SET `benefits` = JSON_SET(`benefits`, '$[2].description', '')
WHERE JSON_UNQUOTE(JSON_EXTRACT(`benefits`, '$[2].description')) = 'We provide 24/7 customer support';
